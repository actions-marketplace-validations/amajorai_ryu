//! HTTP API for per-agent subscription usage (`GET /api/agents/:id/usage`): the
//! "usage bar" feature. Given the agent active in chat, return that agent's
//! rolling rate-limit windows (5h session + weekly) read from the CLI's own
//! local OAuth token, à la CodexBar / openusage.
//!
//! Always 200: refusals (unsupported agent, not logged in, token expired, rate
//! limited) carry `available=false` + a `reason` rather than an HTTP error, so
//! the desktop's dumb bar never branches on status codes — it just hides on
//! `unsupported` and shows a hint otherwise. All the provider logic + the
//! never-refresh token safety lives in the extracted [`ryu_usage`] crate; this
//! handler is the kernel-side route ingress that delegates to it.

use axum::{extract::Path, response::IntoResponse, Json};

/// `GET /api/agents/:id/usage` — normalized usage snapshot for one agent.
///
/// The `{id}` may be an ACP id containing a colon (`acp:claude`); clients must
/// percent-encode it (`encodeURIComponent`), which axum decodes into the single
/// `:id` segment.
#[utoipa::path(
    get,
    path = "/api/agents/{id}/usage",
    tag = "Agents",
    summary = "Per-agent subscription usage (5h + weekly windows)",
    params(("id" = String, Path, description = "Agent id (percent-encode `acp:` ids)")),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn agent_usage(Path(id): Path<String>) -> impl IntoResponse {
    Json(ryu_usage::fetch_usage(&id).await)
}

/// `GET /api/providers/:id/credits` — remaining prepaid API credit on the BYOK
/// key stored for one provider.
///
/// Same always-200 contract as [`agent_usage`]. This handler owns the credential
/// lookup because keys live in Core's `models.json` / `auth.json` — a kernel
/// concept — and hands the key to the reader as an argument, so `ryu-usage` keeps
/// its zero dependency on `apps/core` without gaining a credential seam. The key
/// is never logged and never reaches the response body.
///
/// A provider with no readable balance (OpenAI, Anthropic and most others expose
/// none to an inference key) answers `unsupported`; one with no stored key
/// answers `not_logged_in`. Both make the desktop hide the row rather than
/// display a misleading `$0.00`.
#[utoipa::path(
    get,
    path = "/api/providers/{id}/credits",
    tag = "Agents",
    summary = "Remaining prepaid API credit for a BYOK provider",
    params(("id" = String, Path, description = "Provider id (openrouter / deepseek / moonshot)")),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn provider_credits(Path(id): Path<String>) -> impl IntoResponse {
    // Resolve the key only for a provider that actually has an endpoint to call:
    // reading a credential we have no use for is a needless secret access.
    if !ryu_usage::supports_provider_credits(&id) {
        return Json(ryu_usage::fetch_provider_credits(&id, "").await);
    }
    let key = crate::pi_config::provider_api_key(&id).unwrap_or_default();
    Json(ryu_usage::fetch_provider_credits(&id, &key).await)
}
