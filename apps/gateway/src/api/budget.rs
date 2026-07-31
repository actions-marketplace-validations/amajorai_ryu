//! Budget spend read surface.
//!
//! `GET /v1/budget/spend` exposes the live in-memory per-user / per-agent /
//! per-session token spend the budget stage already tracks
//! ([`crate::budget::BudgetBackend::spend_snapshot`]). The counters existed but
//! had no HTTP read surface, so the desktop could not show spend (P2 #1).
//!
//! Auth: the SAME admin gate as `GET /v1/config` and `GET /v1/audit`
//! ([`crate::api::config::require_local_admin`]) — per-identity spend is
//! tenant-scoped and sensitive, unlike the ungated aggregate `/metrics`. The
//! master key always passes; otherwise only a loopback peer under the
//! zero-config dev posture (the Core-proxy path).
//!
//! There is no per-org *spend* number here — org budgets are a control-plane
//! wallet, and what the node caches is the balance the last debit reported, not
//! a running total. The three token-counter scopes the built-in enforcer keeps
//! (users / agents / sessions) are what this returns; the remaining balance is
//! [`get_wallet`].

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::GatewayError,
    pipeline::{authenticate, AuthInputs},
    state::SharedState,
};

/// Optional scope filters for `GET /v1/budget/spend`. Each narrows the snapshot
/// to a single id in that scope (the desktop showing one session's / user's /
/// agent's spend). Absent ⇒ the full snapshot for that scope.
#[derive(Debug, Default, Deserialize)]
pub struct SpendQuery {
    pub user_id: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
}

/// Retain only `key` in `map` (single-id filter), or leave it untouched when no
/// filter was requested for that scope.
fn filter_scope(
    map: std::collections::HashMap<String, u64>,
    key: &Option<String>,
) -> std::collections::HashMap<String, u64> {
    match key {
        Some(id) => map.into_iter().filter(|(k, _)| k == id).collect(),
        None => map,
    }
}

/// `GET /v1/budget/spend` — live per-scope token spend.
///
/// Returns `{ users, agents, sessions }` maps of id → lifetime tokens
/// (input + output), plus the configured limits so the desktop can render
/// spend-vs-limit without a second `/v1/config` round-trip. In-memory only: a
/// gateway restart resets the counters.
pub async fn get_spend(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<SpendQuery>,
) -> Result<Json<Value>, GatewayError> {
    let raw_key = headers.get("authorization").and_then(|v| v.to_str().ok());
    let ctx = authenticate(&state, AuthInputs::with_key(raw_key)).await?;
    crate::api::config::require_local_admin(
        &state,
        &peer,
        ctx.is_master_key,
        &headers,
        "Budget spend access",
    )?;

    let snapshot = state.with_budget(|b| b.spend_snapshot());
    let config = state.with_budget(|b| b.config().clone());

    Ok(Json(json!({
        "users": filter_scope(snapshot.users, &q.user_id),
        "agents": filter_scope(snapshot.agents, &q.agent_id),
        "sessions": filter_scope(snapshot.sessions, &q.session_id),
        // Configured caps so a caller can compute spend / limit inline. The
        // per-user / per-agent limits are keyed by id (0 = unlimited); the
        // session cap is a single global rule (0 = disabled).
        "limits": {
            "users": config.users.iter().map(|(k, r)| (k.clone(), r.limit)).collect::<std::collections::HashMap<_, _>>(),
            "agents": config.agents.iter().map(|(k, r)| (k.clone(), r.limit)).collect::<std::collections::HashMap<_, _>>(),
            "session": config.session.limit,
        },
    })))
}

/// Optional org scope for `GET /v1/wallet`.
#[derive(Debug, Default, Deserialize)]
pub struct WalletQuery {
    /// Which org's wallet to report. Omit on a single-org node (the normal
    /// case) and the sole cached balance is returned.
    pub org_id: Option<String>,
}

/// `GET /v1/wallet` — the org's remaining Ryu $ balance, as last reported by the
/// control plane on a metered call.
///
/// This exists so Core's threshold fallback rules ("under $5, use the cheap
/// model") have a number to test. Core cannot read the wallet itself — it holds
/// no control-plane session, the balance is an org-level billing fact, and the
/// desktop reads it with the user's own Better-Auth token. The Gateway, however,
/// relearns the authoritative figure on every billed request via its debit hook.
/// One loopback hop, no new credential, and a value exactly as fresh as the last
/// metered call.
///
/// `balance_micro_usd` is **null** when no debit has resolved a balance on this
/// node yet (or when several orgs are cached and no `org_id` was given). Null
/// means *unknown*, and Core's evaluator treats an unknown signal as a reason to
/// abstain — never as "you are out of money".
///
/// Auth: the same local-admin gate as [`get_spend`] — a wallet balance is
/// tenant-scoped billing data, not an aggregate metric.
pub async fn get_wallet(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<WalletQuery>,
) -> Result<Json<Value>, GatewayError> {
    let raw_key = headers.get("authorization").and_then(|v| v.to_str().ok());
    let ctx = authenticate(&state, AuthInputs::with_key(raw_key)).await?;
    crate::api::config::require_local_admin(
        &state,
        &peer,
        ctx.is_master_key,
        &headers,
        "Wallet balance access",
    )?;

    let balance = match q.org_id.as_deref() {
        Some(org_id) => state.wallet.org_balance_micro_usd(org_id),
        None => state.wallet.sole_balance_micro_usd(),
    };
    Ok(Json(json!({
        "org_id": q.org_id,
        "balance_micro_usd": balance,
        // The gate's own verdict, so a caller never has to re-derive it from the
        // balance (and cannot disagree with the gate when the balance is null
        // because a debit failed fail-closed).
        "empty": q
            .org_id
            .as_deref()
            .map(|org_id| state.wallet.is_org_empty(org_id)),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn filter_scope_narrows_to_single_id() {
        let mut m = HashMap::new();
        m.insert("a".to_string(), 10u64);
        m.insert("b".to_string(), 20u64);
        // No filter ⇒ full map.
        let full = filter_scope(m.clone(), &None);
        assert_eq!(full.len(), 2);
        // Filter ⇒ only the requested id.
        let one = filter_scope(m, &Some("a".to_string()));
        assert_eq!(one.len(), 1);
        assert_eq!(one.get("a"), Some(&10));
    }

    #[test]
    fn filter_scope_missing_id_is_empty() {
        let mut m = HashMap::new();
        m.insert("a".to_string(), 10u64);
        let none = filter_scope(m, &Some("zzz".to_string()));
        assert!(none.is_empty());
    }
}
