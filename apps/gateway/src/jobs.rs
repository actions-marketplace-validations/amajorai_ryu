//! In-memory media-job store for job-based (async) generation.
//!
//! Cloud video generation runs for minutes, so it does NOT block a gateway
//! request the way image/TTS/STT do. Instead a submit creates a [`MediaJob`],
//! returns its gateway-minted id, and the client polls the gateway (never the
//! provider directly) so auth, governance, and attribution stay centralized. On
//! each poll the gateway asks the provider for the job's current state via
//! [`crate::providers::Provider::poll_video`] and caches the terminal result.
//!
//! The store is intentionally in-memory and best-effort: a gateway restart loses
//! in-flight jobs (the client re-submits). Terminal jobs and inactive in-flight
//! jobs are pruned both on insert and by a small background sweep so a lost
//! client cannot hold a credit reservation forever.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::budget::CreditReservation;
use crate::config::ProviderId;

/// How long a terminal job is retained before it is pruned.
const JOB_TTL_SECS: u64 = 3600;
/// How long an in-flight job may go without an authorized poll before its
/// reservation is released. This is intentionally bounded even when no new job
/// is submitted to trigger the normal insert-time sweep.
const IN_FLIGHT_JOB_TTL_SECS: u64 = 3600;
const CLEANUP_INTERVAL_SECS: u64 = 60;

/// The provider-produced video-job value types (`JobStatus`, `VideoJob`) moved
/// to the `ryu-gw-providers` crate so the providers can name them (decomposition
/// W6). Re-exported here so existing `crate::jobs::{JobStatus, VideoJob}` paths
/// (and the `MediaJob` fields below) are byte-unchanged. `VideoJob` flows in via
/// the provider return type so it is not named internally; the re-export keeps
/// its `crate::jobs::VideoJob` path valid.
#[allow(unused_imports)]
pub use ryu_gw_providers::jobs::{JobStatus, VideoJob};

/// A gateway-tracked media job. The gateway mints `id` (the request id) and the
/// client polls `GET /v1/videos/generations/{id}`.
#[derive(Debug, Clone)]
pub struct MediaJob {
    pub id: String,
    pub provider: ProviderId,
    pub provider_ref: String,
    pub model: String,
    pub status: JobStatus,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub created_ms: u64,
    /// Last successful submission or authorized poll. Non-terminal jobs use
    /// this timestamp for expiry; terminal retention remains based on
    /// `created_ms` so a hot terminal result cannot live forever.
    pub last_activity_ms: u64,
    /// Org the job is attributed to (for the completion debit + isolation).
    pub org_id: Option<String>,
    /// Forwarded identity dimensions used to settle charged-cost budgets when
    /// the asynchronous job completes during a later poll.
    pub user_id: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    /// API key that submitted the job — a poll must present the same key so one
    /// tenant cannot read another's job by guessing an id.
    pub api_key: String,
    /// In-flight credit claim held until the provider job reaches a terminal
    /// state and any completion debit finishes. An `Arc` keeps `MediaJob` cheap
    /// to snapshot while the store retains the only owning claim.
    pub reservation: Option<Arc<CreditReservation>>,
}

impl MediaJob {
    /// The client-facing JSON for this job. `output` fields are flattened in on
    /// success so a completed poll looks like a normal generation response plus
    /// the `id`/`status` envelope.
    pub fn to_response(&self) -> Value {
        let mut obj = serde_json::Map::new();
        obj.insert("id".into(), Value::String(self.id.clone()));
        obj.insert("status".into(), Value::String(self.status.as_str().into()));
        obj.insert("model".into(), Value::String(self.model.clone()));
        if let Some(output) = &self.output {
            if let Some(map) = output.as_object() {
                for (k, v) in map {
                    obj.insert(k.clone(), v.clone());
                }
            } else {
                obj.insert("output".into(), output.clone());
            }
        }
        if let Some(err) = &self.error {
            obj.insert("error".into(), Value::String(err.clone()));
        }
        Value::Object(obj)
    }
}

/// Milliseconds since the Unix epoch (best-effort; 0 if the clock is before it).
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Thread-safe in-memory job store.
pub struct MediaJobStore {
    jobs: Arc<RwLock<HashMap<String, MediaJob>>>,
}

impl MediaJobStore {
    pub fn new() -> Self {
        let jobs = Arc::new(RwLock::new(HashMap::new()));
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let weak = Arc::downgrade(&jobs);
            handle.spawn(async move {
                let mut interval =
                    tokio::time::interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));
                loop {
                    interval.tick().await;
                    let Some(jobs) = weak.upgrade() else {
                        break;
                    };
                    prune_jobs(&jobs);
                }
            });
        }
        Self { jobs }
    }

    /// Insert (or replace) a job, pruning stale terminal jobs first.
    pub fn insert(&self, job: MediaJob) {
        self.prune_stale();
        if let Ok(mut map) = self.jobs.write() {
            map.insert(job.id.clone(), job);
        }
    }

    /// Fetch a snapshot of a job by id.
    pub fn get(&self, id: &str) -> Option<MediaJob> {
        self.jobs.read().ok().and_then(|m| m.get(id).cloned())
    }

    /// Mark an authorized poll as activity. This is deliberately separate from
    /// `get`: an unauthenticated caller must not keep a guessed job id alive.
    pub fn touch(&self, id: &str) {
        if let Ok(mut map) = self.jobs.write() {
            if let Some(job) = map.get_mut(id) {
                if !job.status.is_terminal() {
                    job.last_activity_ms = now_ms();
                }
            }
        }
    }

    /// Apply one provider poll as an atomic state transition. Only the first
    /// poll that observes a non-terminal job may publish a terminal result, so
    /// concurrent pollers cannot both settle budgets or release the claim.
    pub fn apply_poll(
        &self,
        id: &str,
        status: JobStatus,
        output: Option<Value>,
        error: Option<String>,
    ) -> PollTransition {
        let Ok(mut map) = self.jobs.write() else {
            return PollTransition::default();
        };
        let Some(job) = map.get_mut(id) else {
            return PollTransition::default();
        };
        if job.status.is_terminal() {
            return PollTransition::default();
        }
        let transition = PollTransition {
            applied: true,
            became_terminal: status.is_terminal(),
            became_succeeded: status == JobStatus::Succeeded,
        };
        job.status = status;
        job.output = output;
        job.error = error;
        job.last_activity_ms = now_ms();
        transition
    }

    fn prune_stale(&self) {
        prune_jobs(&self.jobs);
    }

    /// Remove the credit claim exactly once when a terminal job is settled.
    /// Returning it lets the caller keep the RAII release alive until an
    /// asynchronous wallet debit has completed.
    pub fn take_reservation(&self, id: &str) -> Option<Arc<CreditReservation>> {
        self.jobs
            .write()
            .ok()
            .and_then(|mut map| map.get_mut(id).and_then(|job| job.reservation.take()))
    }
}

impl Default for MediaJobStore {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PollTransition {
    pub applied: bool,
    pub became_terminal: bool,
    pub became_succeeded: bool,
}

fn prune_jobs(jobs: &Arc<RwLock<HashMap<String, MediaJob>>>) {
    let now = now_ms();
    let terminal_cutoff = now.saturating_sub(JOB_TTL_SECS * 1000);
    let in_flight_cutoff = now.saturating_sub(IN_FLIGHT_JOB_TTL_SECS * 1000);
    let mut reservations = Vec::new();
    if let Ok(mut map) = jobs.write() {
        map.retain(|_, job| {
            let stale = if job.status.is_terminal() {
                job.created_ms < terminal_cutoff
            } else {
                job.last_activity_ms < in_flight_cutoff
            };
            if stale {
                if let Some(reservation) = job.reservation.take() {
                    reservations.push(reservation);
                }
            }
            !stale
        });
    }
    // Drop outside the store lock. `CreditReservation::drop` updates wallet
    // state and must not run while readers/writers are blocked on this map.
    drop(reservations);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::WalletState;

    #[test]
    fn reservation_is_held_by_the_job_until_taken_once() {
        let wallet = Arc::new(WalletState::default());
        let permit = wallet
            .try_reserve("org-1", 100, 100)
            .expect("reservation fits the available balance");
        let jobs = MediaJobStore::new();
        jobs.insert(MediaJob {
            id: "video-1".to_owned(),
            provider: ProviderId("test".to_owned()),
            provider_ref: "provider-1".to_owned(),
            model: "video-model".to_owned(),
            status: JobStatus::Queued,
            output: None,
            error: None,
            created_ms: now_ms(),
            last_activity_ms: now_ms(),
            org_id: Some("org-1".to_owned()),
            user_id: None,
            agent_id: None,
            session_id: None,
            api_key: "key".to_owned(),
            reservation: Some(Arc::new(permit)),
        });

        assert_eq!(wallet.in_flight_micro_usd("org-1"), 100);
        let held = jobs
            .take_reservation("video-1")
            .expect("the queued job owns the reservation");
        assert!(jobs.take_reservation("video-1").is_none());
        assert_eq!(wallet.in_flight_micro_usd("org-1"), 100);

        drop(held);
        assert_eq!(wallet.in_flight_micro_usd("org-1"), 0);
    }

    #[test]
    fn stale_in_flight_jobs_release_their_reservation_without_a_new_insert() {
        let wallet = Arc::new(WalletState::default());
        let permit = wallet
            .try_reserve("org-1", 100, 100)
            .expect("reservation fits the available balance");
        let jobs = MediaJobStore::new();
        let old = now_ms().saturating_sub((IN_FLIGHT_JOB_TTL_SECS + 1) * 1000);
        jobs.insert(MediaJob {
            id: "video-stale".to_owned(),
            provider: ProviderId("test".to_owned()),
            provider_ref: "provider-stale".to_owned(),
            model: "video-model".to_owned(),
            status: JobStatus::Queued,
            output: None,
            error: None,
            created_ms: old,
            last_activity_ms: old,
            org_id: Some("org-1".to_owned()),
            user_id: None,
            agent_id: None,
            session_id: None,
            api_key: "key".to_owned(),
            reservation: Some(Arc::new(permit)),
        });

        jobs.prune_stale();

        assert!(jobs.get("video-stale").is_none());
        assert_eq!(wallet.in_flight_micro_usd("org-1"), 0);
    }

    #[test]
    fn only_one_concurrent_poll_can_publish_a_terminal_transition() {
        let jobs = MediaJobStore::new();
        jobs.insert(MediaJob {
            id: "video-race".to_owned(),
            provider: ProviderId("test".to_owned()),
            provider_ref: "provider-race".to_owned(),
            model: "video-model".to_owned(),
            status: JobStatus::Queued,
            output: None,
            error: None,
            created_ms: now_ms(),
            last_activity_ms: now_ms(),
            org_id: None,
            user_id: None,
            agent_id: None,
            session_id: None,
            api_key: "key".to_owned(),
            reservation: None,
        });

        let first = jobs.apply_poll(
            "video-race",
            JobStatus::Succeeded,
            Some(serde_json::json!({ "data": [{ "url": "first" }] })),
            None,
        );
        let second = jobs.apply_poll(
            "video-race",
            JobStatus::Succeeded,
            Some(serde_json::json!({ "data": [{ "url": "second" }] })),
            None,
        );

        assert_eq!(
            first,
            PollTransition {
                applied: true,
                became_terminal: true,
                became_succeeded: true
            }
        );
        assert_eq!(second, PollTransition::default());
        assert_eq!(
            jobs.get("video-race").unwrap().output,
            Some(serde_json::json!({ "data": [{ "url": "first" }] }))
        );
    }
}
