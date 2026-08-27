//! Managed provider routing for Core-hosted apps.
//!
//! Apps may request a provider operation, but they never receive a provider key.
//! Core authenticates the sidecar, binds the request to the registered node
//! organization, and forwards it to Gateway. Gateway owns provider-vault lookup,
//! upstream execution, and wallet accounting.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use ryu_app_events::{ManagedProviderCall, ProviderRouterError};
use serde::Deserialize;
use serde_json::json;

use super::ServerState;
use crate::sidecar::{ext_proxy::authenticate_sidecar, gateway};

#[derive(Debug, Deserialize)]
pub(crate) struct ProviderStatusBody {
    pub provider: String,
}

fn invalid(message: impl Into<String>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": message.into() })),
    )
        .into_response()
}

fn failed(error: ProviderRouterError) -> Response {
    let status = match &error {
        ProviderRouterError::Rejected { status, .. } if *status == 401 || *status == 403 => {
            StatusCode::FORBIDDEN
        }
        ProviderRouterError::NotHosted => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::BAD_GATEWAY,
    };
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

/// `POST /api/host/capability/providers.status`.
pub(crate) async fn host_provider_status(
    State(state): State<ServerState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ProviderStatusBody>,
) -> Response {
    if body.provider.trim().is_empty() {
        return invalid("provider is required");
    }
    if let Err((status, message)) = authenticate_sidecar(&state, &headers).await {
        return (status, Json(json!({ "error": message }))).into_response();
    }

    match gateway::managed_provider_status(&state.client, &body.provider).await {
        Ok(configured) => Json(json!({ "configured": configured })).into_response(),
        Err(error) => failed(error),
    }
}

/// `POST /api/host/capability/providers.call`.
pub(crate) async fn host_provider_call(
    State(state): State<ServerState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ManagedProviderCall>,
) -> Response {
    if let Err(error) = body.validate() {
        return failed(error);
    }
    if let Err((status, message)) = authenticate_sidecar(&state, &headers).await {
        return (status, Json(json!({ "error": message }))).into_response();
    }

    let org_id = crate::sidecar::control_plane::registered_org().map(|org| org.id);
    match gateway::call_managed_provider(&state.client, org_id.as_deref(), body).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => failed(error),
    }
}
