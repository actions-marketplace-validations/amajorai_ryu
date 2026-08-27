//! Provider-neutral execution for Core-hosted Ryu apps.
//!
//! The caller supplies an operation, never a provider credential. Gateway resolves
//! the configured provider client, performs the upstream call, and records the
//! provider-native cost against the authenticated organization wallet.

use axum::{extract::State, http::HeaderMap, Json};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::GatewayError,
    pipeline::{authenticate, AuthInputs},
    state::SharedState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusBody {
    pub provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCallBody {
    pub provider: String,
    pub tool_id: String,
    #[serde(default)]
    pub operation: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub query: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    pub request_id: String,
    #[serde(default)]
    pub fallback_cost_micro_usd: Option<u64>,
    #[serde(default)]
    pub task_label: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
}

async fn require_trusted(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<crate::pipeline::RequestContext, GatewayError> {
    let raw_key = headers.get("authorization").and_then(|v| v.to_str().ok());
    // This endpoint is reached by Core's authenticated provider bridge, not by a
    // user-facing app. The Core admin/relay key is represented by a trusted
    // forwarder entry or the local master key.
    let ctx = authenticate(state, AuthInputs::with_key(raw_key)).await?;
    let trusted = ctx.is_master_key
        || ctx
            .key_config
            .as_ref()
            .is_some_and(|config| config.trusted_forwarder);
    if !trusted {
        return Err(GatewayError::Unauthorized(
            "managed provider calls require Core's trusted forwarder".to_owned(),
        ));
    }
    Ok(ctx)
}

/// `POST /v1/providers/status` — provider presence without exposing credentials.
pub async fn provider_status(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ProviderStatusBody>,
) -> Result<Json<Value>, GatewayError> {
    let _ctx = require_trusted(&state, &headers).await?;
    let provider = body.provider.trim();
    let configured = match provider {
        "treg" => state.treg.is_some(),
        "composio" => state.composio.is_some(),
        _ => false,
    };
    Ok(Json(
        json!({ "provider": provider, "configured": configured }),
    ))
}

/// `POST /v1/providers/call` — execute a vault-backed provider operation and
/// schedule its wallet debit from the provider response metadata.
pub async fn provider_call(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ProviderCallBody>,
) -> Result<Json<Value>, GatewayError> {
    let ctx = require_trusted(&state, &headers).await?;
    if !matches!(body.provider.trim(), "treg" | "composio") {
        return Err(GatewayError::BadRequest(
            "unsupported managed provider".to_owned(),
        ));
    }
    if body.tool_id.trim().is_empty() || body.request_id.trim().is_empty() {
        return Err(GatewayError::BadRequest(
            "tool_id and request_id are required".to_owned(),
        ));
    }
    let trusted_forwarder = ctx.is_master_key
        || ctx
            .key_config
            .as_ref()
            .is_some_and(|config| config.trusted_forwarder);
    let org_id = if trusted_forwarder {
        body.org_id.as_deref().or(ctx.org_id.as_deref())
    } else {
        ctx.org_id.as_deref()
    };
    let (ok, status, response_body, provider_cost_micro_usd, call_id, chargeable) =
        if body.provider.trim() == "treg" {
            let method = Method::from_bytes(body.method.trim().as_bytes())
                .map_err(|_| GatewayError::BadRequest("invalid provider method".to_owned()))?;
            let treg = state.treg.clone().ok_or_else(|| {
                GatewayError::ProviderError(
                    "Treg is not configured in the Gateway provider vault".to_owned(),
                )
            })?;
            let response = treg
                .call(
                    &body.tool_id,
                    method,
                    &body.query,
                    body.body.as_ref(),
                    body.idempotency_key.as_deref(),
                    org_id,
                )
                .await
                .map_err(|error| GatewayError::ProviderError(error.to_string()))?;
            (
                response.status.is_success(),
                response.status.as_u16(),
                response.body,
                response.cost_micro_usd,
                response.call_id,
                true,
            )
        } else {
            let composio = state.composio.as_ref().ok_or_else(|| {
                GatewayError::ProviderError(
                    "Composio is not configured in the Gateway provider vault".to_owned(),
                )
            })?;
            // The connected account id is an operation argument, not the
            // Composio entity/user identity. Keep those identities separate so
            // an Outpost publish does not accidentally send its connection id as
            // `user_id`/`entity_id` upstream.
            let entity_id = ctx
                .user_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(state.config.composio.entity_id.as_str());
            let (value, chargeable) = match body.operation.as_deref() {
                Some("capabilities") => (composio.list_tools(&body.tool_id).await?, false),
                Some("connect") => (
                    composio
                        .connect(
                            &body.tool_id,
                            body.account_id.as_deref().unwrap_or(entity_id),
                        )
                        .await?,
                    false,
                ),
                Some("disconnect") => (composio.disconnect(&body.tool_id).await?, false),
                Some("execute") => (
                    composio
                        .execute_with_connection(
                            &body.tool_id,
                            body.body.clone().unwrap_or(Value::Null),
                            entity_id,
                            body.account_id.as_deref(),
                        )
                        .await?,
                    true,
                ),
                _ => {
                    return Err(GatewayError::BadRequest(
                        "Composio managed calls require a supported operation".to_owned(),
                    ));
                }
            };
            (true, 200, value, None, None, chargeable)
        };

    // A failed Treg call is not estimated as spend when it carries no provider
    // cost header (402/5xx are normally free). A provider that explicitly reports
    // a cost is still authoritative, even when its HTTP status is non-success.
    let cost_micro_usd = if ok || provider_cost_micro_usd.is_some() {
        provider_cost_micro_usd.or(body.fallback_cost_micro_usd)
    } else {
        None
    };
    if chargeable {
        crate::pipeline::spawn_external_tool_debit_for_ids(
            &state,
            ctx.user_id.as_deref(),
            ctx.agent_id.as_deref(),
            ctx.session_id.as_deref(),
            org_id,
            &body.request_id,
            ctx.managed_inference,
            body.provider.trim(),
            Some(&body.tool_id),
            cost_micro_usd,
            call_id.as_deref(),
            ok && provider_cost_micro_usd.is_none(),
            body.task_label.as_deref(),
            1,
        );
    }

    Ok(Json(json!({
        "ok": ok,
        "status": status,
        "body": response_body,
        "costMicroUsd": provider_cost_micro_usd,
        "callId": call_id,
    })))
}
