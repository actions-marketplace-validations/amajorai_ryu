# ryu-tracing

The per-run observability trace primitive (#178 / M4): an ordered-span store that
records tool-call and model-call spans keyed by run id, backing the desktop
per-run trace viewer.

## Role in the decomposition

An extracted Core capability crate (L0), **compiled into Core by default** and
consumed as a NON-optional path dependency — the store opens at boot and backs a
`ServerState` field. ZERO dependency on `apps/core`.

## Key API

- `Span` — the v1 span contract: `id`, `conversation_id` (the run id), `kind`
  (`"tool-call"` | `"model-call"`), `name` (tool name or model id), `args_hash`,
  `started_at` / `ended_at` (Unix ms), `error`, and a nullable `session_id`
  linking to the Gateway audit session when the caller has one.
- `TraceStore` (SQLite-backed) — `open(path)` / `open_in_memory()`, `open_span` /
  `close_span`, and `get_spans(conversation_id)` (newest-first per-run reads).
- `hash_args(value)` — SHA-256 hex of the raw tool-input JSON. The store keeps the
  **hash, never the raw payload** — privacy by default.

Persistent stores run a bounded retention pass when opened: 90 days and 1,000,000
spans by default. Set `RYU_TRACE_RETENTION_DAYS=0` or `RYU_TRACE_MAX_ROWS=0` to
disable one bound, or set a positive value to change it. `TraceStore::prune`
applies the same policy on demand. Prompt and response payloads remain in the
conversation store; trace rows intentionally contain ordering, timing,
fingerprints, and errors only.

## How it is consumed

`TraceStore::open` takes an explicit db path, so the crate is pure; the default-
path choice (`~/.ryu/traces.db`) stays Core-side wiring.

## Placement (why Core, not Gateway)

Span ordering and tool-call sequencing are *what ran* (orchestration) → Core.
Token counts and cost are *what is measured/paid* → Gateway audit. This store
deliberately holds **no** tokens/cost fields; `session_id` is the seam that links a
run's spans to the Gateway audit row when the Core caller has a conversation/session
id. Model-call spans from the OpenAI-compatible chat path carry that link; tool
spans may remain unlinked.
