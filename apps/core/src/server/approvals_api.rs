//! HTTP handlers for the human-in-the-loop approval inbox.
//!
//! A thin layer over [`crate::approvals::ApprovalEngine`]: list / get / decide
//! (approve|reject) plus an SSE event stream the desktop inbox + island chip
//! subscribe to. Mirrors `quests_api.rs` (plain `Json` responses, fetch-based SSE
//! so the bearer token can ride the request).

use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::approvals::ApprovalStatus;
use crate::server::ServerState;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// Optional status filter (`pending` / `approved` / `rejected` / `expired` /
    /// `cancelled`). Omitted ⇒ all.
    #[serde(default)]
    status: Option<String>,
}

fn parse_status(s: &str) -> Option<ApprovalStatus> {
    match s {
        "pending" => Some(ApprovalStatus::Pending),
        "approved" => Some(ApprovalStatus::Approved),
        "rejected" => Some(ApprovalStatus::Rejected),
        "expired" => Some(ApprovalStatus::Expired),
        "cancelled" => Some(ApprovalStatus::Cancelled),
        _ => None,
    }
}

/// `GET /api/approvals?status=pending` — list approval requests, newest first.
#[utoipa::path(
    get,
    path = "/api/approvals",
    tag = "Approvals",
    summary = "list approval requests, newest first.",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn list_approvals(
    State(state): State<ServerState>,
    Query(q): Query<ListQuery>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
) -> axum::response::Response {
    if let Err(status) = require_permission(&state, &caller, "approvals.view").await {
        return status.into_response();
    }
    let status = q.status.as_deref().and_then(parse_status);
    match state.approvals.store.list(status).await {
        Ok(approvals) => Json(json!({ "approvals": approvals })).into_response(),
        Err(e) => Json(json!({ "approvals": [], "error": e.to_string() })).into_response(),
    }
}

/// `GET /api/approvals/:id` — fetch a single request.
#[utoipa::path(
    get,
    path = "/api/approvals/{id}",
    tag = "Approvals",
    summary = "fetch a single request.",
    params(("id" = String, Path)),
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn get_approval(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    if let Err(status) = require_permission(&state, &caller, "approvals.view").await {
        return (status, Json(json!({ "success": false, "error": "forbidden" })));
    }
    match state.approvals.store.get(&id).await {
        Ok(Some(req)) => (axum::http::StatusCode::OK, Json(json!({ "approval": req }))),
        Ok(None) => (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "error": "approval not found" })),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        ),
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct DecideBody {
    /// Optional note the deciding user attaches (a reason for the decision).
    #[serde(default)]
    note: Option<String>,
}

async fn decide(
    state: &ServerState,
    id: &str,
    approve: bool,
    note: Option<String>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    match state.approvals.decide(id, approve, note).await {
        Ok(Some(req)) => (axum::http::StatusCode::OK, Json(json!({ "approval": req }))),
        Ok(None) => (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "error": "approval not found" })),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        ),
    }
}

/// `POST /api/approvals/:id/approve` — approve a request (runs its action).
#[utoipa::path(
    post,
    path = "/api/approvals/{id}/approve",
    tag = "Approvals",
    summary = "approve a request (runs its action).",
    params(("id" = String, Path)),
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn approve_approval(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
    body: Option<Json<DecideBody>>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    if let Err(status) = require_permission(&state, &caller, "approvals.decide").await {
        return (status, Json(json!({ "success": false, "error": "forbidden" })));
    }
    let note = body.and_then(|b| b.0.note);
    decide(&state, &id, true, note).await
}

/// `POST /api/approvals/:id/reject` — reject a request (fails a workflow gate).
#[utoipa::path(
    post,
    path = "/api/approvals/{id}/reject",
    tag = "Approvals",
    summary = "reject a request (fails a workflow gate).",
    params(("id" = String, Path)),
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn reject_approval(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
    body: Option<Json<DecideBody>>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    if let Err(status) = require_permission(&state, &caller, "approvals.decide").await {
        return (status, Json(json!({ "success": false, "error": "forbidden" })));
    }
    let note = body.and_then(|b| b.0.note);
    decide(&state, &id, false, note).await
}

/// `GET /api/approvals/mode` — the global approval mode (Layer B): `off` /
/// `smart` / `manual`. `off` is the default (gates nothing).
#[utoipa::path(
    get,
    path = "/api/approvals/mode",
    tag = "Approvals",
    summary = "the global approval mode (Layer B): `off` /",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn get_mode(
    State(state): State<ServerState>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
) -> axum::response::Response {
    if let Err(status) = require_permission(&state, &caller, "approvals.view").await {
        return status.into_response();
    }
    let mode = state.approvals.approval_mode().await;
    Json(json!({ "mode": mode.as_str() })).into_response()
}

#[derive(Debug, Deserialize)]
pub struct SetModeBody {
    /// `off` / `smart` / `manual` (anything else is treated as `off`).
    mode: String,
}

/// `PUT /api/approvals/mode` — set the global approval mode.
#[utoipa::path(
    put,
    path = "/api/approvals/mode",
    tag = "Approvals",
    summary = "set the global approval mode.",
    request_body = serde_json::Value,
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn set_mode(
    State(state): State<ServerState>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
    Json(body): Json<SetModeBody>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    if let Err(status) = require_permission(&state, &caller, "approvals.decide").await {
        return (status, Json(json!({ "success": false, "error": "forbidden" })));
    }
    // Normalize through the enum so only a valid mode is ever stored.
    let mode = crate::approvals::policy::ApprovalMode::from_pref(&body.mode);
    match state
        .preferences
        .set(crate::approvals::policy::APPROVAL_MODE_PREF, mode.as_str())
        .await
    {
        Ok(()) => (
            axum::http::StatusCode::OK,
            Json(json!({ "mode": mode.as_str() })),
        ),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        ),
    }
}

/// `GET /api/approvals/events` — SSE feed of approval events (created / decided).
#[utoipa::path(
    get,
    path = "/api/approvals/events",
    tag = "Approvals",
    summary = "SSE feed of approval events (created / decided).",
    responses((status = 200, description = "OK", body = serde_json::Value))
)]
pub async fn approval_events(
    State(state): State<ServerState>,
    Extension(caller): Extension<Option<crate::identity_verify::VerifiedCaller>>,
) -> axum::response::Response {
    // The SSE stream contains approval titles, summaries, and tool arguments;
    // require the same verified app permission as the list route before opening
    // the long-lived subscription.
    if let Err(status) = require_permission(&state, &caller, "approvals.view").await {
        return status.into_response();
    }
    use axum::response::sse::{Event, KeepAlive, Sse};
    use tokio::sync::broadcast::error::RecvError;

    let rx = state.approvals.store.subscribe();
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    return Some((
                        Ok::<_, std::convert::Infallible>(Event::default().data(data)),
                        rx,
                    ));
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

async fn require_permission(
    state: &ServerState,
    caller: &Option<crate::identity_verify::VerifiedCaller>,
    permission: &str,
) -> Result<(), axum::http::StatusCode> {
    // Approval decisions are governance actions. Unlike a local read-only
    // catalog, a node-token-only/paired request must not list or execute a
    // user's pending action, even on an otherwise unbound node.
    if caller.is_none() {
        return Err(axum::http::StatusCode::FORBIDDEN);
    }
    super::enforce_permission(state, caller, permission).await
}
