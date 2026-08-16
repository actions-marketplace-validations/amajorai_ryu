//! Governed embedding and reranking endpoints.
//!
//! These routes deliberately accept a model id, not an upstream URL or key.
//! The Gateway authenticates the caller, resolves the model through its normal
//! routing table, and keeps provider credentials inside the configured provider.

use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;

use crate::{
    error::GatewayError,
    pipeline::{authenticate, AuthInputs},
    state::SharedState,
};

const MAX_EMBED_INPUTS: usize = 256;
const MAX_EMBED_CHARS: usize = 16_384;
const MAX_RERANK_DOCUMENTS: usize = 128;
const MAX_RERANK_CHARS: usize = 32_768;

pub async fn embeddings(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    validate_embeddings(&body)?;
    let model = required_model(&body)?;
    let ctx = authenticate(
        &state,
        AuthInputs {
            raw_api_key: headers.get("authorization").and_then(|v| v.to_str().ok()),
            user_id: header_string(&headers, "x-ryu-user-id"),
            agent_id: header_string(&headers, "x-ryu-agent-id"),
            ..Default::default()
        },
    )
    .await?;
    dispatch(&state, &ctx.request_id, &model, &body, Operation::Embed).await
}

pub async fn rerank(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    validate_rerank(&body)?;
    let model = required_model(&body)?;
    let ctx = authenticate(
        &state,
        AuthInputs {
            raw_api_key: headers.get("authorization").and_then(|v| v.to_str().ok()),
            user_id: header_string(&headers, "x-ryu-user-id"),
            agent_id: header_string(&headers, "x-ryu-agent-id"),
            ..Default::default()
        },
    )
    .await?;
    dispatch(&state, &ctx.request_id, &model, &body, Operation::Rerank).await
}

#[derive(Clone, Copy)]
enum Operation {
    Embed,
    Rerank,
}

async fn dispatch(
    state: &SharedState,
    request_id: &str,
    requested_model: &str,
    body: &Value,
    operation: Operation,
) -> Result<Response, GatewayError> {
    let route = state
        .router
        .route(requested_model.strip_prefix("gateway/").unwrap_or(requested_model));
    let provider_id = route.provider.as_str();
    let provider = state
        .providers
        .get(provider_id)
        .ok_or_else(|| GatewayError::NoProvider(provider_id.to_owned()))?;
    let response = match operation {
        Operation::Embed => provider.embed(&route.model, body).await?,
        Operation::Rerank => provider.rerank(&route.model, body).await?,
    };
    let mut output = Json(response).into_response();
    let headers = output.headers_mut();
    if let Ok(value) = HeaderValue::from_str(request_id) {
        headers.insert("x-request-id", value);
    }
    if let Ok(value) = HeaderValue::from_str(provider_id) {
        headers.insert("x-provider", value);
    }
    if let Ok(value) = HeaderValue::from_str(&route.model) {
        headers.insert("x-routed-model", value);
    }
    Ok(output)
}

fn required_model(body: &Value) -> Result<String, GatewayError> {
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| GatewayError::BadRequest("model is required".to_owned()))
}

fn validate_embeddings(body: &Value) -> Result<(), GatewayError> {
    let input = body
        .get("input")
        .ok_or_else(|| GatewayError::BadRequest("input is required".to_owned()))?;
    let inputs = match input {
        Value::String(text) => vec![text.as_str()],
        Value::Array(values) => values
            .iter()
            .map(|value| {
                value.as_str().ok_or_else(|| {
                    GatewayError::BadRequest("embedding input must be strings".to_owned())
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(GatewayError::BadRequest(
                "input must be a string or array".to_owned(),
            ))
        }
    };
    if inputs.len() > MAX_EMBED_INPUTS {
        return Err(GatewayError::BadRequest(format!(
            "at most {MAX_EMBED_INPUTS} embedding inputs are allowed"
        )));
    }
    if inputs.iter().any(|text| text.len() > MAX_EMBED_CHARS) {
        return Err(GatewayError::BadRequest(format!(
            "embedding inputs may be at most {MAX_EMBED_CHARS} characters"
        )));
    }
    Ok(())
}

fn validate_rerank(body: &Value) -> Result<(), GatewayError> {
    let query = body
        .get("query")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| GatewayError::BadRequest("query is required".to_owned()))?;
    let documents = body
        .get("documents")
        .and_then(Value::as_array)
        .ok_or_else(|| GatewayError::BadRequest("documents must be an array".to_owned()))?;
    if documents.len() > MAX_RERANK_DOCUMENTS {
        return Err(GatewayError::BadRequest(format!(
            "at most {MAX_RERANK_DOCUMENTS} rerank documents are allowed"
        )));
    }
    if documents.iter().any(|document| !document.is_string()) {
        return Err(GatewayError::BadRequest(
            "rerank documents must be strings".to_owned(),
        ));
    }
    if query.len() > MAX_RERANK_CHARS
        || documents
            .iter()
            .any(|document| document.as_str().is_some_and(|text| text.len() > MAX_RERANK_CHARS))
    {
        return Err(GatewayError::BadRequest(format!(
            "rerank text may be at most {MAX_RERANK_CHARS} characters"
        )));
    }
    Ok(())
}

fn header_string(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn embedding_validation_rejects_oversized_batches() {
        let input = (0..=MAX_EMBED_INPUTS)
            .map(|_| Value::String("x".to_owned()))
            .collect::<Vec<_>>();
        let error = validate_embeddings(&json!({"model": "embed", "input": input}))
            .expect_err("oversized embedding batch must be rejected");
        assert!(error.to_string().contains("at most"));
    }

    #[test]
    fn rerank_validation_rejects_non_string_documents() {
        let error = validate_rerank(&json!({
            "model": "rerank",
            "query": "q",
            "documents": ["ok", {"secret": "not a document"}]
        }))
        .expect_err("non-string documents must be rejected");
        assert!(error.to_string().contains("documents must be strings"));
    }

    #[test]
    fn model_validation_rejects_blank_ids() {
        let error =
            required_model(&json!({"model": "  "})).expect_err("blank model ids must be rejected");
        assert!(error.to_string().contains("model is required"));
    }
}
