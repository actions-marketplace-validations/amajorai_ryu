//! Token → org resolve cache (multi-tenant data plane).
//!
//! The hosted gateway serves many organizations; each client presents its minted
//! `rgw_` gateway token as `Authorization: Bearer`. Resolving that token to an
//! org + budget + policy is a control-plane round-trip, so we cache the result
//! keyed by the token.
//!
//! Two TTLs, mirroring a DNS-style positive/negative cache:
//!   - **Positive** (~60s): a resolved org is reused so the hot path never hits
//!     the control plane on every request. 60s also bounds how stale a budget can
//!     be — a topped-up org auto-recovers within one window (the pre-flight gate
//!     reads the freshly-fetched `remaining_budget`).
//!   - **Negative** (~10s): an invalid/revoked/unreachable token is cached briefly
//!     so a flood of bad bearers cannot turn into a resolve-DoS against the control
//!     plane. Short so a just-minted token isn't locked out for long.
//!
//! Enabled only when a control-plane URL is configured (`CONTROL_PLANE_URL`); when
//! absent the dynamic path is a no-op and single-org behavior is unchanged. The
//! raw token is used only as the in-memory map key — it is never logged.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;

use super::{resolve_token, CredentialUse, ResolvedOrg};

/// Env var with the control-plane base URL (no trailing `/api`). Same source as
/// [`super::PolicySource`] so the startup and dynamic paths reach one endpoint.
const ENV_CONTROL_PLANE_URL: &str = "CONTROL_PLANE_URL";

/// Positive cache TTL: how long a successful resolve is reused.
const POSITIVE_TTL: Duration = Duration::from_secs(60);
/// Negative cache TTL: how long a failed resolve (invalid/revoked/unreachable) is
/// cached to blunt a resolve-DoS from a flood of bad bearers.
const NEGATIVE_TTL: Duration = Duration::from_secs(10);
const MAX_ENTRIES: usize = 4096;
const MAX_TOKEN_BYTES: usize = 256;
const MAX_CONCURRENT_RESOLVES: usize = 32;

#[derive(Default)]
struct CacheState {
    entries: HashMap<String, CachedResolve>,
    in_flight: HashSet<String>,
}

// Remove the marker on success, timeout, or cancellation. No synchronous guard
// survives an await, and duplicate misses fail closed instead of queuing work.
struct InFlight<'a> {
    state: &'a Mutex<CacheState>,
    token: &'a str,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .in_flight
            .remove(self.token);
    }
}

/// Resolution failure or temporary admission pressure. Neither grants access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveErr {
    /// The token did not resolve to an org: invalid, revoked, or the control
    /// plane was unreachable. Caller returns 401.
    Unresolved,
    /// Retryable admission pressure; caller returns 429, never invalid credentials.
    Busy,
}

/// One cache entry: the resolve outcome and when it was stored.
struct CachedResolve {
    /// `Ok` holds the resolved org (shared, cheap to clone out); `Err(())` is a
    /// negative entry (the token did not resolve).
    resolved: Result<Arc<ResolvedOrg>, ()>,
    fetched_at: Instant,
}

impl CachedResolve {
    /// Whether this entry is still fresh at `now` under its TTL (positive entries
    /// live longer than negative ones).
    fn is_fresh(&self, now: Instant) -> bool {
        let ttl = if self.resolved.is_ok() {
            POSITIVE_TTL
        } else {
            NEGATIVE_TTL
        };
        now.duration_since(self.fetched_at) < ttl
    }
}

/// Caches token → org resolutions for the multi-tenant data plane.
pub struct ResolveCache {
    /// Control-plane base URL (no `/api` suffix).
    control_plane_url: String,
    http: reqwest::Client,
    state: Mutex<CacheState>,
    admission: Semaphore,
}

impl ResolveCache {
    /// Build from environment, sharing the gateway's HTTP client. Returns `None`
    /// when `CONTROL_PLANE_URL` is unset/empty — the dynamic path stays a no-op.
    pub fn from_env(http: reqwest::Client) -> Option<Self> {
        let url = std::env::var(ENV_CONTROL_PLANE_URL)
            .ok()
            .filter(|s| !s.is_empty())?;
        Some(Self {
            control_plane_url: url.trim_end_matches('/').to_string(),
            http,
            state: Mutex::new(CacheState::default()),
            admission: Semaphore::new(MAX_CONCURRENT_RESOLVES),
        })
    }

    /// Resolve a token, serving a fresh cached value if present else calling the
    /// control plane and storing the outcome (positive or negative). The raw
    /// token is used only as the map key; it is never logged.
    pub async fn resolve_cached(&self, token: &str) -> Result<Arc<ResolvedOrg>, ResolveErr> {
        if token.is_empty() || token.len() > MAX_TOKEN_BYTES {
            return Err(ResolveErr::Unresolved);
        }
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let now = Instant::now();
            state.entries.retain(|_, entry| entry.is_fresh(now));
            if let Some(entry) = state.entries.get(token) {
                return entry.resolved.clone().map_err(|()| ResolveErr::Unresolved);
            }
        }
        // Never queue unauthenticated work. Fresh cache hits remain available
        // while misses are saturated, and permits release when futures cancel.
        let _permit = self.admission.try_acquire().map_err(|_| ResolveErr::Busy)?;
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // Another request may have completed between lookup and admission.
            if let Some(entry) = state.entries.get(token) {
                if entry.is_fresh(Instant::now()) {
                    return entry.resolved.clone().map_err(|()| ResolveErr::Unresolved);
                }
            }
            if !state.in_flight.insert(token.to_owned()) {
                return Err(ResolveErr::Busy);
            }
        }
        let _in_flight = InFlight {
            state: &self.state,
            token,
        };
        let resolved = resolve_token(
            &self.control_plane_url,
            &self.http,
            token,
            CredentialUse::GatewayRelay,
        )
        .await
        .map(Arc::new)
        .map_err(|_| ());
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let now = Instant::now();
            state.entries.retain(|_, entry| entry.is_fresh(now));
            if state.entries.len() >= MAX_ENTRIES {
                // Evict under the same lock as insertion: parallel completions
                // cannot exceed the capacity after independently checking it.
                if let Some(oldest) = state
                    .entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.fetched_at)
                    .map(|(key, _)| key.clone())
                {
                    state.entries.remove(&oldest);
                }
            }
            state.entries.insert(
                token.to_owned(),
                CachedResolve {
                    resolved: resolved.clone(),
                    fetched_at: now,
                },
            );
        }
        resolved.map_err(|()| ResolveErr::Unresolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::EffectivePolicy;

    fn sample_org() -> Arc<ResolvedOrg> {
        Arc::new(ResolvedOrg {
            org_id: "o1".to_string(),
            managed_inference: true,
            remaining_budget_micro_usd: Some(1000),
            unrestricted_budget_micro_usd: None,
            pool_budgets_micro_usd: std::collections::HashMap::new(),
            policy: EffectivePolicy::default(),
        })
    }

    #[test]
    fn positive_entry_is_fresh_within_ttl_and_stale_after() {
        let base = Instant::now();
        let entry = CachedResolve {
            resolved: Ok(sample_org()),
            fetched_at: base,
        };
        // Fresh well within 60s.
        assert!(entry.is_fresh(base + Duration::from_secs(30)));
        // Stale past 60s.
        assert!(!entry.is_fresh(base + Duration::from_secs(90)));
    }

    #[test]
    fn negative_entry_has_shorter_ttl() {
        let base = Instant::now();
        let entry = CachedResolve {
            resolved: Err(()),
            fetched_at: base,
        };
        // Fresh within 10s.
        assert!(entry.is_fresh(base + Duration::from_secs(5)));
        // Stale past 10s — much sooner than a positive entry, which is still
        // fresh at the same instant.
        assert!(!entry.is_fresh(base + Duration::from_secs(15)));
        let positive = CachedResolve {
            resolved: Ok(sample_org()),
            fetched_at: base,
        };
        assert!(positive.is_fresh(base + Duration::from_secs(15)));
    }

    async fn mock_control_plane() -> (
        ResolveCache,
        Arc<std::sync::atomic::AtomicUsize>,
        Arc<Semaphore>,
        tokio::task::JoinHandle<()>,
    ) {
        use axum::{http::HeaderMap, response::IntoResponse, routing::get, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(Semaphore::new(0));
        let handler_calls = calls.clone();
        let handler_gate = gate.clone();
        let app = Router::new().route("/api/control-plane/gateway/resolve", get(move |headers: HeaderMap| {
            let calls = handler_calls.clone();
            let gate = handler_gate.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                let key = headers.get("x-gateway-key").unwrap().to_str().unwrap();
                if key.contains("wait") {
                    gate.acquire().await.unwrap().forget();
                }
                if key.starts_with("rgw_good") {
                    axum::Json(serde_json::json!({"organization":{"id":"org_test"}, "credential":{"purpose":"gateway_relay", "allowedOperations":["gateway.inference"]}})).into_response()
                } else {
                    axum::http::StatusCode::UNAUTHORIZED.into_response()
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (
            ResolveCache {
                control_plane_url: format!("http://{address}"),
                http: reqwest::Client::new(),
                state: Mutex::new(CacheState::default()),
                admission: Semaphore::new(MAX_CONCURRENT_RESOLVES),
            },
            calls,
            gate,
            server,
        )
    }

    #[tokio::test]
    async fn actual_http_unique_failures_and_successes_stay_bounded() {
        use std::sync::atomic::Ordering;
        let (cache, calls, _, server) = mock_control_plane().await;
        for i in 0..MAX_ENTRIES + 8 {
            assert!(cache.resolve_cached(&format!("rgw_bad_{i}")).await.is_err());
            assert!(cache.state.lock().unwrap().entries.len() <= MAX_ENTRIES);
        }
        for i in 0..8 {
            assert_eq!(
                cache
                    .resolve_cached(&format!("rgw_good_{i}"))
                    .await
                    .unwrap()
                    .org_id,
                "org_test"
            );
            assert!(cache.state.lock().unwrap().entries.len() <= MAX_ENTRIES);
        }
        let before = calls.load(Ordering::SeqCst);
        assert!(cache
            .resolve_cached(&format!("rgw_bad_{}", MAX_ENTRIES + 7))
            .await
            .is_err());
        assert!(cache.resolve_cached("rgw_good_7").await.is_ok());
        assert_eq!(calls.load(Ordering::SeqCst), before);
        server.abort();
    }

    #[tokio::test]
    async fn expired_entries_are_removed_and_oversize_tokens_do_no_work() {
        use std::sync::atomic::Ordering;
        let (cache, calls, _, server) = mock_control_plane().await;
        assert!(cache
            .resolve_cached(&"x".repeat(MAX_TOKEN_BYTES + 1))
            .await
            .is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(cache.state.lock().unwrap().entries.is_empty());
        assert!(cache.resolve_cached("rgw_good_expired").await.is_ok());
        assert!(cache.resolve_cached("rgw_bad_expired").await.is_err());
        for entry in cache.state.lock().unwrap().entries.values_mut() {
            entry.fetched_at = Instant::now() - POSITIVE_TTL;
        }
        assert!(cache.resolve_cached("rgw_good_fresh").await.is_ok());
        assert_eq!(cache.state.lock().unwrap().entries.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn concurrent_misses_are_bounded_deduplicated_and_cancel_safe() {
        use std::sync::atomic::Ordering;
        let (cache, calls, gate, server) = mock_control_plane().await;
        let cache = Arc::new(cache);
        // Prime a hit to prove saturated misses do not block cached clients.
        assert!(cache.resolve_cached("rgw_good_cached").await.is_ok());
        let first_cache = cache.clone();
        let first =
            tokio::spawn(async move { first_cache.resolve_cached("rgw_wait_duplicate").await });
        tokio::time::timeout(Duration::from_secs(3), async {
            while calls.load(Ordering::SeqCst) != 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(cache.resolve_cached("rgw_wait_duplicate").await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        first.abort();
        let _ = first.await;
        let baseline = calls.load(Ordering::SeqCst);
        let mut pending = Vec::new();
        for i in 0..MAX_CONCURRENT_RESOLVES {
            let cache = cache.clone();
            pending.push(tokio::spawn(async move {
                cache.resolve_cached(&format!("rgw_wait_{i}")).await
            }));
        }
        tokio::time::timeout(Duration::from_secs(3), async {
            while calls.load(Ordering::SeqCst) != MAX_CONCURRENT_RESOLVES + baseline {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(cache.resolve_cached("rgw_wait_overflow").await.is_err());
        assert!(cache.resolve_cached("rgw_wait_0").await.is_err());
        assert!(cache.resolve_cached("rgw_good_cached").await.is_ok());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            MAX_CONCURRENT_RESOLVES + baseline
        );
        assert_eq!(
            cache.state.lock().unwrap().in_flight.len(),
            MAX_CONCURRENT_RESOLVES
        );
        for task in pending {
            task.abort();
            let _ = task.await;
        }
        assert!(cache.state.lock().unwrap().in_flight.is_empty());
        assert_eq!(cache.admission.available_permits(), MAX_CONCURRENT_RESOLVES);
        gate.add_permits(MAX_CONCURRENT_RESOLVES + 1);
        assert!(cache.resolve_cached("rgw_good_after_cancel").await.is_ok());
        server.abort();
    }

    #[tokio::test]
    async fn gateway_http_refresh_is_retryable_and_invalid_bearers_stay_unauthorized() {
        use std::sync::atomic::Ordering;
        let (cache, calls, gate, control_server) = mock_control_plane().await;
        let config = crate::config::GatewayConfig {
            auth: crate::config::AuthConfig {
                require_auth: true,
                master_key: None,
                api_keys: vec![],
            },
            ..Default::default()
        };
        let audit = crate::audit::AuditLogger::new(&crate::config::AuditConfig {
            enabled: false,
            db_path: String::new(),
        })
        .unwrap();
        let evals = crate::evals::EvalsRunner::new(crate::config::EvalsConfig::default());
        let mut state = crate::state::AppState::new_for_test(config, audit, evals);
        state.resolve_cache = Some(cache);
        let state = Arc::new(state);
        let app = crate::api::router(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let gateway = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap()
        });
        let url = format!("http://{address}/v1/budget/spend");
        let client = reqwest::Client::new();
        let first_url = url.clone();
        let first_client = client.clone();
        let first = tokio::spawn(async move {
            first_client
                .get(first_url)
                .bearer_auth("rgw_good_wait")
                .send()
                .await
                .unwrap()
        });
        tokio::time::timeout(Duration::from_secs(3), async {
            while calls.load(Ordering::SeqCst) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let busy = client
            .get(&url)
            .bearer_auth("rgw_good_wait")
            .send()
            .await
            .unwrap();
        assert_eq!(busy.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        gate.add_permits(1);
        // Valid org credentials still cannot read owner-only spend; importantly,
        // normal resolution completes rather than caching refresh pressure as 401.
        assert_eq!(
            first.await.unwrap().status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&url)
                .bearer_auth("rgw_good_wait")
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(state
            .resolve_cache
            .as_ref()
            .unwrap()
            .state
            .lock()
            .unwrap()
            .entries
            .get("rgw_good_wait")
            .unwrap()
            .resolved
            .is_ok());
        assert_eq!(
            client
                .get(&url)
                .bearer_auth("rgw_invalid")
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&url)
                .bearer_auth(format!("rgw_{}", "x".repeat(MAX_TOKEN_BYTES)))
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        println!("Gateway HTTP proof: concurrent valid refresh=429, valid non-admin=401 (master-key gate), invalid=401, oversized=401; upstream resolves=2; no provider requests");
        gateway.abort();
        control_server.abort();
    }
}
