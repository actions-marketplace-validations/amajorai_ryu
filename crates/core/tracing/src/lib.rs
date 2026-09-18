//! Per-run observability trace store (spec unit #178 / M4).
//!
//! Persists ordered spans keyed by `conversation_id` (the run id) in a local
//! SQLite database (`~/.ryu/traces.db`).  Each span records:
//!   - `kind`        — `"tool-call"` or `"model-call"`
//!   - `name`        — tool name or model id
//!   - `args_hash`   — SHA-256 hex of the tool input (tool-call spans only;
//!                     NOT the raw payload — privacy by default)
//!   - `started_at`  — Unix milliseconds (write time)
//!   - `ended_at`    — Unix milliseconds (finish time; `None` while running)
//!   - `error`       — non-`None` when the span ended with an error
//!   - `session_id`  — nullable link to the Gateway audit session when the
//!                     caller has one; model-call spans receive the Core
//!                     conversation id and tool spans may remain `None`
//!
//! Placement rationale (Core vs Gateway, see CLAUDE.md §1): span ordering and
//! tool-call sequencing are *what ran* (orchestration) — Core.  Token counts,
//! cost, and provider-latency are *what is measured/paid* — Gateway audit only.
//! Core's trace intentionally stores NO tokens/cost fields.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// A single ordered span within a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Span {
    /// Stable row id (UUID).
    pub id: String,
    /// The run this span belongs to (`conversation_id` from the chat request).
    pub conversation_id: String,
    /// `"tool-call"` or `"model-call"`.
    pub kind: String,
    /// Tool name (tool-call) or model id (model-call).
    pub name: String,
    /// SHA-256 hex of the raw tool-input JSON (tool-call only).  Never the raw
    /// payload — protects sensitive args from being stored in Core.
    pub args_hash: Option<String>,
    /// Unix milliseconds — when the span was opened.
    pub started_at: i64,
    /// Unix milliseconds — when the span was closed.  `None` while in-flight.
    pub ended_at: Option<i64>,
    /// Error message if the span ended with a failure.
    pub error: Option<String>,
    /// Nullable link to the Gateway audit session. Model-call spans carry the
    /// Core conversation id; tool spans may omit the link.
    pub session_id: Option<String>,
    /// Autoincrement ordering key (monotonically increasing within the DB).
    pub seq: i64,
}

/// SQLite-backed trace store.  Cheap to clone — wraps an `Arc<Mutex<Connection>>`.
#[derive(Clone)]
pub struct TraceStore {
	conn: Arc<Mutex<Connection>>,
	path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct TracePruneSummary {
	pub deleted_rows: u64,
	pub retention_days: Option<u64>,
	pub max_rows: Option<u64>,
}

const DEFAULT_TRACE_RETENTION_DAYS: u64 = 90;
const DEFAULT_TRACE_MAX_ROWS: u64 = 1_000_000;

fn trace_retention_policy() -> (Option<u64>, Option<u64>) {
	let parse = |name: &str, fallback: u64| {
		std::env::var(name)
			.ok()
			.and_then(|value| value.trim().parse::<u64>().ok())
			.map(|value| if value == 0 { None } else { Some(value) })
			.unwrap_or(Some(fallback))
	};
	(
		parse("RYU_TRACE_RETENTION_DAYS", DEFAULT_TRACE_RETENTION_DAYS),
		parse("RYU_TRACE_MAX_ROWS", DEFAULT_TRACE_MAX_ROWS),
	)
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// SHA-256 hex of a JSON value's canonical representation.
pub fn hash_args(value: &serde_json::Value) -> String {
    use std::fmt::Write;
    // Canonical form: serialize the value (serde_json is deterministic for
    // the same in-memory Value; sufficient for a privacy-safe fingerprint).
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = sha2_digest(&bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Minimal SHA-256 implementation using the `sha2` crate (already in the
/// dependency tree via rustls/ring).  Isolated here so the rest of the module
/// has no sha2 import noise.
fn sha2_digest(data: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(data);
    h.finalize().into()
}

impl TraceStore {
    /// Open (or create) the trace store at a specific path.
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating trace db dir {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("opening trace db {}", path.display()))?;
        Self::init_schema(&conn)?;
		let (retention_days, max_rows) = trace_retention_policy();
		let summary = prune_connection(&conn, retention_days, max_rows)?;
		if summary.deleted_rows > 0 {
			tracing::info!(deleted_rows = summary.deleted_rows, "trace retention pass removed old spans");
		}
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
			path: Some(path),
        })
    }

    /// Open an in-memory store (tests / ephemeral use).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().context("opening in-memory trace db")?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
			path: None,
        })
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS spans (
                 seq             INTEGER PRIMARY KEY AUTOINCREMENT,
                 id              TEXT NOT NULL UNIQUE,
                 conversation_id TEXT NOT NULL,
                 kind            TEXT NOT NULL,
                 name            TEXT NOT NULL,
                 args_hash       TEXT,
                 started_at      INTEGER NOT NULL,
                 ended_at        INTEGER,
                 error           TEXT,
                 session_id      TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_spans_conversation
                 ON spans(conversation_id, seq);",
        )
        .context("initializing trace schema")?;

        // Additive migration guard — safe to call on every startup.
        let existing: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(spans)")?;
            let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
            names.filter_map(|r| r.ok()).collect()
        };
        if !existing.contains("session_id") {
            conn.execute_batch("ALTER TABLE spans ADD COLUMN session_id TEXT")
                .context("adding session_id column")?;
        }

        Ok(())
    }

    /// Open a span (tool-call or model-call).  Returns the new span id.
    ///
    /// `args_hash` should be `Some(hash_args(&input))` for tool-call spans and
    /// `None` for model-call spans.
    pub async fn open_span(
        &self,
        conversation_id: &str,
        kind: &str,
        name: &str,
        args_hash: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<String> {
        let span_id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO spans (id, conversation_id, kind, name, args_hash, started_at, session_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                span_id,
                conversation_id,
                kind,
                name,
                args_hash,
                now,
                session_id
            ],
        )
        .context("inserting span")?;
        Ok(span_id)
    }

    /// Close a span — set `ended_at` and optionally record an error.
    pub async fn close_span(&self, span_id: &str, error: Option<&str>) -> Result<()> {
        let now = now_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE spans SET ended_at = ?1, error = ?2 WHERE id = ?3",
            params![now, error, span_id],
        )
        .context("closing span")?;
        Ok(())
    }

    /// Return all spans for a run in ascending `seq` order.
    pub async fn get_spans(&self, conversation_id: &str) -> Result<Vec<Span>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT seq, id, conversation_id, kind, name, args_hash,
                    started_at, ended_at, error, session_id
             FROM spans
             WHERE conversation_id = ?1
             ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            Ok(Span {
                seq: row.get(0)?,
                id: row.get(1)?,
                conversation_id: row.get(2)?,
                kind: row.get(3)?,
                name: row.get(4)?,
                args_hash: row.get(5)?,
                started_at: row.get(6)?,
                ended_at: row.get(7)?,
                error: row.get(8)?,
                session_id: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("reading spans")
    }

    /// Delete every span for a temporary or deleted run. Trace rows have no
    /// independent ownership; retaining them after their conversation disappears
    /// would leave no durable ACL principal to authorize a later read.
    pub async fn delete_spans(&self, conversation_id: &str) -> Result<u64> {
        let conn = self.conn.lock().await;
        Ok(conn.execute(
            "DELETE FROM spans WHERE conversation_id = ?1",
            params![conversation_id],
        )? as u64)
    }

	/// Apply the configured trace retention policy immediately. In-memory stores
	/// are intentionally no-ops; persistent stores use the same bounded policy
	/// that runs at startup.
	pub async fn prune(&self) -> Result<TracePruneSummary> {
		let Some(_path) = &self.path else {
			return Ok(TracePruneSummary::default());
		};
		let (retention_days, max_rows) = trace_retention_policy();
		let conn = self.conn.lock().await;
		prune_connection(&conn, retention_days, max_rows)
	}
}

fn prune_connection(
	conn: &Connection,
	retention_days: Option<u64>,
	max_rows: Option<u64>,
) -> Result<TracePruneSummary> {
	let mut deleted_rows = 0_u64;
	if let Some(days) = retention_days {
		let cutoff = chrono::Utc::now()
			.checked_sub_signed(chrono::Duration::days(days.min(i64::MAX as u64) as i64))
			.map(|value| value.timestamp_millis())
			.unwrap_or(i64::MIN);
		deleted_rows = deleted_rows.saturating_add(
			conn.execute("DELETE FROM spans WHERE started_at < ?1", params![cutoff])? as u64,
		);
	}
	if let Some(max_rows) = max_rows {
		let max_rows = max_rows.min(i64::MAX as u64) as i64;
		deleted_rows = deleted_rows.saturating_add(
			conn.execute(
				"DELETE FROM spans
				 WHERE seq NOT IN (SELECT seq FROM spans ORDER BY seq DESC LIMIT ?1)",
				params![max_rows],
			)? as u64,
		);
	}
	Ok(TracePruneSummary {
		deleted_rows,
		retention_days,
		max_rows,
	})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn write_and_read_back_tool_call_span() {
        let store = TraceStore::open_in_memory().unwrap();
        let conv_id = "test-conv-1";

        // Open a tool-call span.
        let input = serde_json::json!({ "path": "/tmp/foo.txt" });
        let ah = hash_args(&input);
        let span_id = store
            .open_span(conv_id, "tool-call", "read_file", Some(&ah), None)
            .await
            .unwrap();

        // Close it successfully.
        store.close_span(&span_id, None).await.unwrap();

        // Read back.
        let spans = store.get_spans(conv_id).await.unwrap();
        assert_eq!(spans.len(), 1);
        let s = &spans[0];
        assert_eq!(s.conversation_id, conv_id);
        assert_eq!(s.kind, "tool-call");
        assert_eq!(s.name, "read_file");
        assert!(s.args_hash.is_some());
        assert!(s.ended_at.is_some());
        assert!(s.error.is_none());
    }

    #[tokio::test]
    async fn delete_spans_removes_temporary_run_evidence() {
        let store = TraceStore::open_in_memory().unwrap();
        let span_id = store
            .open_span("temporary-eval", "model-call", "m1", None, None)
            .await
            .unwrap();
        store.close_span(&span_id, None).await.unwrap();
        assert_eq!(store.delete_spans("temporary-eval").await.unwrap(), 1);
        assert!(store
            .get_spans("temporary-eval")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn error_span_records_message() {
        let store = TraceStore::open_in_memory().unwrap();
        let span_id = store
            .open_span("conv-2", "tool-call", "bash", None, None)
            .await
            .unwrap();
        store
            .close_span(&span_id, Some("permission denied"))
            .await
            .unwrap();
        let spans = store.get_spans("conv-2").await.unwrap();
        assert_eq!(spans[0].error.as_deref(), Some("permission denied"));
    }

    #[tokio::test]
    async fn model_call_span_keeps_session_link_without_payload() {
        let store = TraceStore::open_in_memory().unwrap();
        let span_id = store
            .open_span(
                "conv-model",
                "model-call",
                "gpt-4o-mini",
                None,
                Some("conv-model"),
            )
            .await
            .unwrap();
        store.close_span(&span_id, None).await.unwrap();

        let spans = store.get_spans("conv-model").await.unwrap();
        assert_eq!(spans[0].kind, "model-call");
        assert_eq!(spans[0].name, "gpt-4o-mini");
        assert_eq!(spans[0].session_id.as_deref(), Some("conv-model"));
        assert!(spans[0].args_hash.is_none());
    }

    #[tokio::test]
    async fn multiple_spans_ordered_by_seq() {
        let store = TraceStore::open_in_memory().unwrap();
        let conv = "conv-order";
        for name in ["alpha", "beta", "gamma"] {
            let id = store
                .open_span(conv, "tool-call", name, None, None)
                .await
                .unwrap();
            store.close_span(&id, None).await.unwrap();
        }
        let spans = store.get_spans(conv).await.unwrap();
        assert_eq!(spans.len(), 3);
        assert!(spans[0].seq < spans[1].seq);
        assert!(spans[1].seq < spans[2].seq);
        assert_eq!(spans[0].name, "alpha");
        assert_eq!(spans[2].name, "gamma");
    }
}
