use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::{json, Value};

use crate::state::SharedState;
use crate::{
    error::GatewayError,
    pipeline::{authenticate, AuthInputs},
};

/// GET /v1/tools/composio
///
/// Returns the list of Composio action names configured in the gateway
/// allowlist. This endpoint passes through standard auth (master-key or
/// API-key) so callers can discover which actions are available before
/// constructing a chat request.
///
/// When Composio is disabled or no actions are configured the response is
/// an empty list (not a 404) so the caller can distinguish "no actions
/// allowed" from "endpoint missing."
pub async fn list_composio_tools(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), GatewayError> {
    let raw_key = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok());
    authenticate(&state, AuthInputs::with_key(raw_key)).await?;
    let actions: Vec<Value> = match &state.composio {
        Some(composio) => composio
            .actions()
            .iter()
            .map(|name| {
                json!({
                    "name": name,
                    "type": "composio",
                    "description": format!(
                        "Composio action '{}'. Invoked automatically when the model \
                         emits a tool_call with this name.",
                        name
                    )
                })
            })
            .collect(),
        None => vec![],
    };

    let body = json!({
        "object": "list",
        "data": actions,
        "composio_enabled": state.composio.is_some(),
    });

    Ok((StatusCode::OK, Json(body)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::sync::Arc;

    #[tokio::test]
    async fn empty_list_when_composio_disabled_requires_gateway_auth() {
        let mut state = AppState::new_for_test_default();
        state.auth.write().expect("test auth lock").require_auth = false;
        let state = Arc::new(state);
        let (status, Json(body)) = list_composio_tools(State(state), HeaderMap::new())
            .await
            .expect("no-auth test gateway should allow the request");
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["object"], "list");
        assert_eq!(body["composio_enabled"], false);
        assert_eq!(body["data"].as_array().unwrap().len(), 0);
    }
}
