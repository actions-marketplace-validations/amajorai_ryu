//! Live traffic bus: the in-memory broadcast seam behind `GET /v1/traffic`.
//!
//! Every request that reaches the audit sink is published here as a small
//! redacted JSON event, so the desktop's live-traffic dashboard can render
//! requests as they complete without re-querying the SQLite audit store. The
//! bus is deliberately thin:
//!
//! * **Not a backend** — it does not persist anything. The audit store remains
//!   the system of record; this is a live-only overlay for observability.
//! * **Redacted at the source** — the API key is truncated to its prefix here,
//!   never broadcast in full, mirroring the `/v1/audit` query path.
//! * **Best-effort** — a slow subscriber is dropped (broadcast semantics); the
//!   ring buffer only serves late joiners a bounded tail of history.
//!
//! The pipeline funnels through [`AppState::log_audit`] (the gateway's single
//! audit chokepoint), which logs to the active audit backend AND broadcasts to
//! this bus — so no call site that records an audit row can forget the live
//! feed, and none of the ~14 sites needed touching.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::audit::AuditRecord;

/// How many recent events a late subscriber receives on connect. Bounded so a
/// reconnect never floods the client with the whole history.
const RING_CAPACITY: usize = 200;

/// Broadcast capacity. A subscriber that falls this far behind is lagged and
/// dropped; the next reconnect re-seeds from the ring.
const CHANNEL_CAPACITY: usize = 1024;

/// Broadcast channel for live request traffic. `Mutex`-free on the hot path:
/// subscribers receive via the channel; the ring is only touched on publish
/// (append) and snapshot (`recent`).
pub struct TrafficBus {
    sender: broadcast::Sender<Value>,
    /// Bounded tail of recent events, newest last, for late-joining subscribers.
    ring: Mutex<VecDeque<Value>>,
}

impl Default for TrafficBus {
    fn default() -> Self {
        Self::new()
    }
}

impl TrafficBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            sender,
            ring: Mutex::new(VecDeque::with_capacity(RING_CAPACITY)),
        }
    }

    /// Publish a redacted request event. Returns the number of subscribers that
    /// received it (0 when none are connected — a no-op for the hot path).
    pub fn publish(&self, event: Value) -> usize {
        if let Ok(mut ring) = self.ring.lock() {
            if ring.len() >= RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(event.clone());
        }
        self.sender.send(event).unwrap_or(0)
    }

    /// Subscribe to the live broadcast channel. Does NOT seed history — the
    /// caller snapshots [`Self::recent`] and dedups by `request_id`, so a
    /// connect between the snapshot and the subscribe can't double-deliver.
    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.sender.subscribe()
    }

    /// Snapshot the ring buffer (newest last). Paired with a fresh subscribe:
    /// emit the snapshot first, then live events, skipping any whose
    /// `request_id` is already in the snapshot.
    pub fn recent(&self) -> Vec<Value> {
        self.ring
            .lock()
            .map(|r| r.iter().cloned().collect())
            .unwrap_or_default()
    }
}

/// Build the redacted live-traffic event for an audit record. The API key is
/// truncated to its leading characters (mirroring the audit query path); the
/// raw key never leaves the process.
pub fn traffic_event(record: &AuditRecord) -> Value {
    json!({
        "request_id": record.request_id,
        "api_key": redact_key(&record.api_key),
        "provider": record.provider,
        "model": record.model,
        "input_tokens": record.input_tokens,
        "output_tokens": record.output_tokens,
        "cache_hit": record.cache_hit,
        "latency_ms": record.latency_ms,
        "error": record.error,
        "event_type": record.event_type.as_str(),
        "session_id": record.session_id,
        "user_id": record.user_id,
        "agent_id": record.agent_id,
        "ts": chrono::Utc::now().to_rfc3339(),
    })
}

/// Truncate a key to its visible prefix, mirroring the audit query path. Keys
/// shorter than the prefix are fully masked.
fn redact_key(key: &str) -> String {
    const PREFIX: usize = 6;
    if key.len() <= PREFIX {
        "***".to_string()
    } else {
        format!("{}***", &key[..PREFIX])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::EventType;

    fn sample_record(request_id: &str, error: Option<&str>) -> AuditRecord {
        AuditRecord {
            request_id: request_id.to_string(),
            api_key: "sk-secret-1234567890".to_string(),
            user_name: Some("alice".to_string()),
            org_id: Some("org-1".to_string()),
            team_id: None,
            project_id: None,
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            input_tokens: 10,
            output_tokens: 5,
            cache_hit: false,
            latency_ms: 42,
            eval_score: None,
            error: error.map(|e| e.to_string()),
            skill_ids: None,
            session_id: Some("sess-1".to_string()),
            event_type: EventType::ModelCall,
            backend: None,
            command: None,
            duration_ms: None,
            exit_code: None,
            user_id: None,
            agent_id: None,
            feature: None,
            widget_instance_id: None,
        }
    }

    #[test]
    fn live_subscriber_receives_published_events() {
        let bus = TrafficBus::new();
        let mut rx = bus.subscribe();
        bus.publish(json!({ "request_id": "r1", "model": "gpt-4o" }));
        let got = rx.blocking_recv().unwrap();
        assert_eq!(got["request_id"], "r1");
        assert_eq!(got["model"], "gpt-4o");
    }

    #[test]
    fn ring_is_bounded() {
        let bus = TrafficBus::new();
        for i in 0..(RING_CAPACITY + 50) {
            bus.publish(json!({ "i": i }));
        }
        let recent = bus.recent();
        assert_eq!(recent.len(), RING_CAPACITY);
        assert_eq!(recent[0]["i"], 50);
        assert_eq!(recent.last().unwrap()["i"], RING_CAPACITY + 49);
    }

    #[test]
    fn recent_snapshot_matches_publish_order() {
        let bus = TrafficBus::new();
        bus.publish(json!({ "request_id": "r1" }));
        bus.publish(json!({ "request_id": "r2" }));
        let recent = bus.recent();
        assert_eq!(recent[0]["request_id"], "r1");
        assert_eq!(recent[1]["request_id"], "r2");
    }

    #[test]
    fn event_redacts_key() {
        let e = traffic_event(&sample_record("req-1", None));
        assert_eq!(e["api_key"], "sk-sec***");
        assert_eq!(e["model"], "gpt-4o");
        assert_eq!(e["event_type"], "model_call");
        assert!(e["ts"].is_string());
        assert!(e.get("api_key").unwrap().as_str().unwrap().contains("***"));
    }
}
