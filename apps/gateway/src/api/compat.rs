//! Inbound protocol-compat handlers: Anthropic `/v1/messages` and Google Gemini
//! `generateContent` / `streamGenerateContent`.
//!
//! Each handler authenticates like `/v1/chat/completions`, normalizes the
//! native-format request to the pipeline's OpenAI shape (via the pure functions
//! in `crate::compat`), runs the SAME governed pipeline (budgets, firewall,
//! routing, audit, live traffic), then projects the OpenAI response back to the
//! caller's native format.
//!
//! The streaming variants translate the pipeline's OpenAI SSE byte stream into
//! the native SSE dialect on the fly, reusing the tree's `stream::unfold`
//! chunking convention (no `async-stream` macro).

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::stream::{Stream, StreamExt};
use serde_json::{json, Value};
use tracing::debug;

use crate::{
    compat,
    error::GatewayError,
    pipeline::{self, authenticate, AuthInputs},
    state::SharedState,
};

/// Authenticate a compat request. Compat clients (Claude Code, Gemini SDKs) do
/// not send the full `x-ryu-*` header set, so only the bearer key is threaded;
/// forwarded identity fields default to `None`.
async fn authenticate_compat(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<pipeline::RequestContext, GatewayError> {
    let raw_key = headers.get("authorization").and_then(|v| v.to_str().ok());
    authenticate(state, AuthInputs::with_key(raw_key)).await
}

// ── Anthropic Messages (`POST /v1/messages`) ────────────────────────────────

/// `POST /v1/messages` — Anthropic Messages dialect. Translates the request to
/// the unified OpenAI body, runs the pipeline, and speaks the response back in
/// Anthropic's wire format.
pub async fn anthropic_messages(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    debug!(peer = %peer, "anthropic-compat: messages");
    let ctx = authenticate_compat(&state, &headers).await?;

    let requested_model = body["model"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let is_stream = body["stream"].as_bool().unwrap_or(false);
    let openai_body = compat::anthropic::request_to_openai(&body);
    let openai_body = with_stream(openai_body, is_stream);

    if is_stream {
        let output = pipeline::run_stream(state, ctx, openai_body).await?;
        let translated = translate_openai_stream_to_anthropic(output.body);
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .header("x-request-id", &output.context.request_id)
            .body(axum::body::Body::from_stream(translated))
            .map_err(|e| GatewayError::Internal(anyhow::anyhow!("response build error: {e}")))?;
        if let Ok(v) = HeaderValue::from_str(&output.model_used) {
            response.headers_mut().insert("x-routed-model", v);
        }
        Ok(response)
    } else {
        let output = pipeline::run(state, ctx, openai_body).await?;
        let native =
            compat::anthropic::response_to_anthropic(&output.response, &requested_model, &output.context.request_id);
        let mut response = Json(native).into_response();
        if let Ok(v) = HeaderValue::from_str(&output.context.request_id) {
            response.headers_mut().insert("x-request-id", v);
        }
        if let Ok(v) = HeaderValue::from_str(&output.model_used) {
            response.headers_mut().insert("x-routed-model", v);
        }
        Ok(response)
    }
}

// ── Gemini (`generateContent` / `streamGenerateContent`) ─────────────────────

/// `POST /v1beta/models/{model}:generateContent` — Google Gemini dialect. The
/// model is taken from the URL path (Gemini carries it there, not in the body).
/// The whole trailing segment is captured (`{model}:generateContent` /
/// `{model}:streamGenerateContent`) because the operation suffix shares the
/// model's path segment — there is no slash between `gemini-2.0-flash` and
/// `:generateContent`. Streaming is selected by the `:streamGenerateContent`
/// suffix (the Gemini protocol carries it on the URL, not the body).
pub async fn gemini_generate(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(spec): axum::extract::Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    let (model, op) = split_gemini_spec(&spec);
    let force_stream = op == "streamGenerateContent";
    gemini_generate_impl(state, peer, model, headers, body, force_stream).await
}

/// Split a captured `{model}:generateContent` path segment into model + op.
/// A spec without a `:` (a bare model) is still usable.
fn split_gemini_spec(spec: &str) -> (String, String) {
    match spec.rsplit_once(':') {
        Some((model, op)) => (model.to_string(), op.to_string()),
        None => (spec.to_string(), String::new()),
    }
}

async fn gemini_generate_impl(
    state: SharedState,
    peer: SocketAddr,
    model: String,
    headers: HeaderMap,
    mut body: Value,
    force_stream: bool,
) -> Result<Response, GatewayError> {
    debug!(peer = %peer, model = %model, "gemini-compat: generateContent");
    let ctx = authenticate_compat(&state, &headers).await?;

    // The model lives on the URL; inject it into the normalized body so the
    // pipeline routes it.
    body["model"] = Value::String(model.clone());
    let is_stream = force_stream || body["stream"].as_bool().unwrap_or(false);
    let openai_body = compat::gemini::request_to_openai(&body);
    let openai_body = with_stream(openai_body, is_stream);

    if is_stream {
        let output = pipeline::run_stream(state, ctx, openai_body).await?;
        let translated = translate_openai_stream_to_gemini(output.body);
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .header("x-request-id", &output.context.request_id)
            .body(axum::body::Body::from_stream(translated))
            .map_err(|e| GatewayError::Internal(anyhow::anyhow!("response build error: {e}")))?;
        if let Ok(v) = HeaderValue::from_str(&output.model_used) {
            response.headers_mut().insert("x-routed-model", v);
        }
        Ok(response)
    } else {
        let output = pipeline::run(state, ctx, openai_body).await?;
        let native = compat::gemini::response_to_gemini(&output.response, &model);
        let mut response = Json(native).into_response();
        if let Ok(v) = HeaderValue::from_str(&output.context.request_id) {
            response.headers_mut().insert("x-request-id", v);
        }
        if let Ok(v) = HeaderValue::from_str(&output.model_used) {
            response.headers_mut().insert("x-routed-model", v);
        }
        Ok(response)
    }
}

// ── SSE dialect translation ──────────────────────────────────────────────────

/// Force the streaming flag on the normalized body.
fn with_stream(mut body: Value, stream: bool) -> Value {
    body["stream"] = Value::Bool(stream);
    body
}

/// Translate the pipeline's OpenAI SSE byte stream into Anthropic Messages SSE
/// events. The pipeline emits `data: {chunk}\n\n` lines ending in `data: [DONE]`;
/// Anthropic wants `event:` + `data:` pairs.
fn translate_openai_stream_to_anthropic(
    body: axum::body::Body,
) -> impl Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    use futures_util::stream;

    let inner = body.into_data_stream();
    let pending = Vec::<u8>::new();

    // Accumulate the text deltas; Anthropic requires a `message_start`,
    // `content_block_start`, then one `content_block_delta` per text fragment,
    // then `content_block_stop` / `message_stop` at the end.
    stream::unfold(
        (inner, pending, false),
        |(mut inner, mut pending, mut finished)| async move {
            loop {
                match inner.next().await {
                    Some(Ok(bytes)) => {
                        pending.extend_from_slice(&bytes);
                        let split_at = match pending.iter().rposition(|b| *b == b'\n') {
                            Some(i) => i + 1,
                            None => continue,
                        };
                        let ready: Vec<u8> = pending.drain(..split_at).collect();
                        let text = String::from_utf8_lossy(&ready);
                        for line in text.lines() {
                            if finished {
                                continue;
                            }
                            let Some(data) = line.trim().strip_prefix("data:") else {
                                continue;
                            };
                            let data = data.trim();
                            if data == "[DONE]" {
                                finished = true;
                                continue;
                            }
                            let Ok(chunk) = serde_json::from_str::<Value>(data) else {
                                continue;
                            };
                            if let Some(delta) = chunk["choices"][0]["delta"]["content"].as_str() {
                                // Emit an anthropic text delta event.
                                let event = format!(
                                    "event: content_block_delta\ndata: {}\n\n",
                                    json!({
                                        "type": "content_block_delta",
                                        "index": 0,
                                        "delta": { "type": "text_delta", "text": delta },
                                    })
                                );
                                return Some((Ok(bytes::Bytes::from(event)), (inner, pending, finished)));
                            }
                        }
                    }
                    Some(Err(e)) => {
                        return Some((
                            Err(std::io::Error::other(e.to_string())),
                            (inner, pending, finished),
                        ))
                    }
                    None => {
                        // End of stream: emit the terminal events once.
                        if !finished {
                            finished = true;
                            let tail = "event: message_delta\ndata: {}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
                            return Some((Ok(bytes::Bytes::from(tail)), (inner, pending, finished)));
                        }
                        return None;
                    }
                }
            }
        },
    )
}

/// Translate the pipeline's OpenAI SSE byte stream into Gemini `streamGenerateContent`
/// chunks. Gemini expects a bare `data: {candidates...}` line per chunk with no
/// named events.
fn translate_openai_stream_to_gemini(
    body: axum::body::Body,
) -> impl Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    use futures_util::stream;

    let inner = body.into_data_stream();
    let pending = Vec::<u8>::new();

    stream::unfold((inner, pending), |(mut inner, mut pending)| async move {
        loop {
            match inner.next().await {
                Some(Ok(bytes)) => {
                    pending.extend_from_slice(&bytes);
                    let split_at = match pending.iter().rposition(|b| *b == b'\n') {
                        Some(i) => i + 1,
                        None => continue,
                    };
                    let ready: Vec<u8> = pending.drain(..split_at).collect();
                    let text = String::from_utf8_lossy(&ready);
                    for line in text.lines() {
                        let Some(data) = line.trim().strip_prefix("data:") else {
                            continue;
                        };
                        let data = data.trim();
                        if data == "[DONE]" {
                            continue;
                        }
                        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
                            continue;
                        };
                        if let Some(delta) = chunk["choices"][0]["delta"]["content"].as_str() {
                            let event = format!(
                                "data: {}\n\n",
                                json!({
                                    "candidates": [{
                                        "content": {
                                            "role": "model",
                                            "parts": [{ "text": delta }],
                                        },
                                        "finishReason": "STOP",
                                    }],
                                })
                            );
                            return Some((Ok(bytes::Bytes::from(event)), (inner, pending)));
                        }
                    }
                }
                Some(Err(e)) => {
                    return Some((Err(std::io::Error::other(e.to_string())), (inner, pending)))
                }
                None => return None,
            }
        }
    })
}
