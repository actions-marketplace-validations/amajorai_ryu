# ryu-gw-budget

Ryu **Gateway** charged-spend budget stage — the first crate extracted in the Gateway pipeline
decomposition.

## What it is

The data-plane half of budget enforcement (U21). Every request is checked inline against
in-memory charged-spend counters keyed by user id / agent id / session id (no SQLite on the hot path,
no network call). Budget amounts are integer micro-USD (`1_000_000` = `$1.00`). It also holds the
per-window **exec budget** for tool execution. Spend counters are lifetime totals and live only in
memory — a restart resets them; durable accounting is the audit log's and the control-plane
coordinator's (U29) job.

## Role in the decomposition

An **extracted gateway stage crate**: its config value-types live here (the Gateway re-exports them,
so `crate::config::Budget*` paths and `GatewayConfig.budgets` / `.exec_budget` are unchanged). The
swap seam is a **backend trait + registry**:

- `BudgetBackend` — the trait a swappable enforcer implements.
- `BudgetRegistry` — id-keyed holder; the built-in `BudgetEnforcer` (`BUILTIN = "builtin"`) is
  active by default; `with_active` runs against it.

## Key API

- `BudgetEnforcer::new(BudgetConfig)` — the built-in.
- `evaluate` / `evaluate_session` -> `Option<BudgetDecision>` — the inline check.
- `record` / `record_session` — count charged micro-USD after a call.
- `user_usage` / `agent_usage` / `session_usage` — charged-spend counter readers.
- `BudgetAction` (`Notify` / `Downgrade` / `Restrict` / `Stop`), `BudgetRule`, `BudgetScope`,
  `ExecBudgetConfig`, `ExecBudgetAction`.
- Re-exports `AlertTier` from `ryu-gw-contracts` (the orthogonal alert-fan-out tier).

## How it is consumed

Compiled **into the Gateway** binary (`apps/gateway`). Depends only on `ryu-gw-contracts` for the
shared `AlertTier`. Swap the enforcer by registering a different `BudgetBackend`.
