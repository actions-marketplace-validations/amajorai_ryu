# ryu-gw-audit

Ryu **Gateway** audit stage, extracted into a self-contained crate as part of the
Gateway pipeline decomposition (peer of `ryu-gw-budget` / `ryu-gw-evals`).

## What it is

The append-only request log. A SQLite-backed (`rusqlite`, bundled) durable record of every
governed model/tool call plus lifetime per-API-key token totals, with query + summary readers.
Records are written off the hot path via a background writer thread (`mpsc` + `Mutex<Connection>`).

## Role in the decomposition

An **extracted gateway stage crate**: the stage's logic and its own config type live here so the
crate is self-contained, and the Gateway re-exports them (`crate::config::AuditConfig` paths and
`GatewayConfig.audit` are unchanged). The swap seam is a **backend trait + registry**:

- `AuditBackend` — the trait a swappable audit sink implements.
- `AuditRegistry` — id-keyed holder; the built-in `AuditLogger` (`BUILTIN = "builtin"`) is active
  by default. Register an alternate sink and `set_active` to swap.

## Key API

- `AuditConfig` — `{ enabled, db_path }` (defaults to `$XDG_DATA_HOME/ryu/audit.db`).
  `RYU_AUDIT_DB_PATH` is a runtime path override used by Core-managed children
  to keep profile-isolated audit rows beside the active Core data directory; it
  is not persisted into `gateway.toml`.
- `AuditLogger::new` / `log` — the built-in SQLite writer; `make_exec_record`,
  `make_widget_call_record`, `make_widget_followup_record`, `make_credential_read_record`
  build the typed `AuditRecord`s.
- `token_usage` / `add_tokens` — lifetime token accounting per API key.
- `query(&AuditQuery) -> Vec<AuditEntry>`, `summary() -> AuditSummary` — the read side.
- `prune() -> AuditPruneSummary` — apply the bounded local retention policy on demand; the same
  pass runs automatically at startup.
- `EventType`, `AuditRecord`, `AuditQuery`, `AuditSummary`, `AuditEntry` — value types.

The default retention policy is 90 days and 1,000,000 rows. `RYU_AUDIT_RETENTION_DAYS=0` and
`RYU_AUDIT_MAX_ROWS=0` disable one bound; positive values override it. Pruning only removes local
rows and recomputes the aggregate summary; it never exports or accepts raw SQL.

## How it is consumed

Compiled **into the Gateway** binary (`apps/gateway`), which owns the pipeline wiring that
constructs records and drives the registry. Not a sidecar, not a UI. Swap the sink by registering a
different `AuditBackend`.
