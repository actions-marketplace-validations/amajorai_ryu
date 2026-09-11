//! Native ChatGPT-account provider transport for the managed Pi.
//!
//! This is the server-side half of the first-class ChatGPT provider. Pi sends
//! the native Codex/Responses wire format to this loopback route; Core resolves
//! the selected ChatGPT session from its sealed provider vault, refreshes the
//! private copy when necessary, and forwards the request to ChatGPT's account
//! backed Responses service. Raw credentials never cross the desktop API.

use axum::{
    body::{Body, Bytes},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

const DEFAULT_UPSTREAM: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CLIENT_VERSION: &str = "0.144.1";
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;

fn upstream() -> String {
    std::env::var("RYU_CHATGPT_UPSTREAM")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPSTREAM.to_owned())
}

fn client_version() -> String {
    std::env::var("RYU_CHATGPT_CLIENT_VERSION")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_VERSION.to_owned())
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default()
    })
}

async fn auth_headers() -> Result<(String, String), Response> {
    // The proxy is the active-turn path, so it is allowed to refresh the Ryu-owned
    // copy. This never touches ~/.codex or a vendor CLI's single-use refresh token.
    let _ = crate::pi_config::refresh_oauth(crate::pi_config::CHATGPT_AUTH_KEY).await;
    let credential =
        crate::pi_config::subscription_active_credential(crate::pi_config::CHATGPT_PROVIDER_ID)
            .map_err(internal_error)?
            .ok_or_else(|| auth_error("ChatGPT is not connected"))?;
    let access = credential
        .get("access")
        .or_else(|| credential.get("access_token"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| auth_error("ChatGPT session has no access token"))?;
    let account_id = credential
        .get("accountId")
        .or_else(|| credential.get("account_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| auth_error("ChatGPT session has no account id"))?;
    Ok((access.to_owned(), account_id.to_owned()))
}

fn auth_error(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": { "code": "chatgpt_not_connected", "message": message } })),
    )
        .into_response()
}

fn internal_error(error: anyhow::Error) -> Response {
    tracing::warn!(error = %error, "native ChatGPT provider credential lookup failed");
    (
        StatusCode::BAD_GATEWAY,
        Json(json!({
            "error": {
                "code": "chatgpt_credential_error",
                "message": "ChatGPT provider credentials could not be resolved"
            }
        })),
    )
        .into_response()
}

fn upstream_error(status: reqwest::StatusCode, _body: String) -> Response {
    let message = format!("ChatGPT upstream returned {status}");
    (
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
        Json(json!({ "error": { "code": "chatgpt_upstream_error", "message": message } })),
    )
        .into_response()
}

fn request_builder(
    method: reqwest::Method,
    url: &str,
    access: &str,
    account_id: &str,
) -> reqwest::RequestBuilder {
    client()
        .request(method, url)
        .header("Authorization", format!("Bearer {access}"))
        .header("ChatGPT-Account-ID", account_id)
        .header("originator", "codex_cli_rs")
        .header("User-Agent", "Ryu")
}

/// Forward a native Responses request while keeping ChatGPT auth inside Core.
pub async fn responses(body: Bytes) -> Response {
    if body.len() > MAX_REQUEST_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({ "error": { "code": "request_too_large", "message": "request body is too large" } })),
        )
            .into_response();
    }
    let (access, account_id) = match auth_headers().await {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let url = format!("{}/responses", upstream());
    let response = match request_builder(reqwest::Method::POST, &url, &access, &account_id)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .body(body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "native ChatGPT provider upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": { "code": "chatgpt_upstream_unreachable", "message": "ChatGPT upstream could not be reached" } })),
            )
                .into_response();
        }
    };
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return upstream_error(status, body);
    }

    let content_type = response
        .headers()
        .get("content-type")
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("text/event-stream"));
    let stream = response.bytes_stream().map(|chunk| {
        chunk.map_err(|error| std::io::Error::other(format!("ChatGPT stream: {error}")))
    });
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

fn model_items(value: &Value) -> Vec<Value> {
    let mut items = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.get("items").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();
    if let Some(models) = value.get("models").and_then(Value::as_object) {
        items.extend(
            models
                .iter()
                .map(|(id, entry)| json!({ "id": id, "name": entry.get("name") })),
        );
    }
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter_map(|entry| {
            let id = entry.as_str().map(str::to_owned).or_else(|| {
                entry
                    .get("slug")
                    .or_else(|| entry.get("id"))
                    .or_else(|| entry.get("model"))
                    .or_else(|| entry.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })?;
            if !seen.insert(id.clone()) {
                return None;
            }
            let mut item = Map::new();
            item.insert("id".to_owned(), Value::String(id));
            item.insert("object".to_owned(), Value::String("model".to_owned()));
            item.insert(
                "created".to_owned(),
                Value::Number(serde_json::Number::from(0)),
            );
            item.insert("owned_by".to_owned(), Value::String("chatgpt".to_owned()));
            Some(Value::Object(item))
        })
        .collect()
}

/// Account-aware ChatGPT model discovery. The upstream list is normalized to
/// OpenAI's {object:"list",data:[...]} shape for Pi's picker.
pub async fn models() -> Response {
    let (access, account_id) = match auth_headers().await {
        Ok(headers) => headers,
        Err(response) => return response,
    };
    let response = match request_builder(
        reqwest::Method::GET,
        &format!("{}/models", upstream()),
        &access,
        &account_id,
    )
    .query(&[("client_version", client_version())])
    .header("Accept", "application/json")
    .send()
    .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "native ChatGPT model discovery failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": { "code": "chatgpt_models_unreachable", "message": "ChatGPT models could not be loaded" } })),
            )
                .into_response();
        }
    };
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return upstream_error(status, body);
    }
    let body = match response.json::<Value>().await {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(error = %error, "native ChatGPT model discovery returned invalid JSON");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": { "code": "chatgpt_models_invalid", "message": "ChatGPT models response was invalid" } })),
            )
                .into_response();
        }
    };
    Json(json!({ "object": "list", "data": model_items(&body) })).into_response()
}

#[cfg(test)]
mod tests {
    use super::{model_items, request_builder};
    use reqwest::Method;
    use serde_json::{json, Value};

    #[test]
    fn normalizes_account_model_shapes_and_deduplicates() {
        let items = model_items(&json!({
            "models": [
                { "slug": "gpt-5.5" },
                { "id": "gpt-5.5" },
                "gpt-5.4"
            ]
        }));
        assert_eq!(
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .collect::<Vec<_>>(),
            vec!["gpt-5.5", "gpt-5.4"]
        );
    }

    #[test]
    fn upstream_requests_carry_account_headers_without_persisting_the_bearer() {
        let request = request_builder(
            Method::GET,
            "https://chatgpt.example/codex/models",
            "access-token",
            "account-id",
        )
        .build()
        .expect("build request");

        assert_eq!(request.headers()["Authorization"], "Bearer access-token");
        assert_eq!(request.headers()["ChatGPT-Account-ID"], "account-id");
        assert_eq!(request.headers()["originator"], "codex_cli_rs");
        assert_eq!(request.headers()["User-Agent"], "Ryu");
    }
}
