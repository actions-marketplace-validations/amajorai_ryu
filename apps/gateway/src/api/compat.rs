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

use std::collections::HashMap;
use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Query, State},
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
    query_key: Option<&str>,
) -> Result<pipeline::RequestContext, GatewayError> {
    let raw_key = compat_api_key(headers, query_key);
    authenticate(state, AuthInputs::with_key(raw_key)).await
}

fn compat_api_key<'a>(headers: &'a HeaderMap, query_key: Option<&'a str>) -> Option<&'a str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-api-key").and_then(|v| v.to_str().ok()))
        .or_else(|| headers.get("x-goog-api-key").and_then(|v| v.to_str().ok()))
        .or(query_key)
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
    let ctx = authenticate_compat(&state, &headers, None).await?;

    let requested_model = body["model"].as_str().unwrap_or("unknown").to_string();
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
        let native = compat::anthropic::response_to_anthropic(
            &output.response,
            &requested_model,
            &output.context.request_id,
        );
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
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    let (model, op) = split_gemini_spec(&spec);
    let force_stream = op == "streamGenerateContent";
    gemini_generate_impl(
        state,
        peer,
        model,
        headers,
        query.get("key").map(String::as_str),
        body,
        force_stream,
    )
    .await
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
    query_key: Option<&str>,
    mut body: Value,
    force_stream: bool,
) -> Result<Response, GatewayError> {
    debug!(peer = %peer, model = %model, "gemini-compat: generateContent");
    let ctx = authenticate_compat(&state, &headers, query_key).await?;

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

#[derive(Default)]
struct AnthropicStreamState {
    finished: bool,
    started: bool,
    next_block_index: usize,
    text_block_index: Option<usize>,
    tool_blocks: Vec<AnthropicToolBlock>,
    saw_tool_call: bool,
    stop_reason: Option<String>,
    message_id: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
}

struct AnthropicToolBlock {
    openai_index: u64,
    anthropic_index: usize,
    id: String,
    name: String,
    started: bool,
    closed: bool,
}

fn anthropic_event(event_type: &str, data: Value) -> String {
    format!("event: {event_type}\ndata: {data}\n\n")
}

fn anthropic_start(state: &mut AnthropicStreamState, chunk: &Value) -> String {
    if state.started {
        return String::new();
    }
    state.started = true;
    state.message_id = chunk["id"]
        .as_str()
        .unwrap_or("chatcmpl-compat")
        .to_string();
    state.model = chunk["model"].as_str().unwrap_or_default().to_string();
    anthropic_event(
        "message_start",
        json!({
            "type": "message_start",
            "message": {
                "id": state.message_id,
                "type": "message",
                "role": "assistant",
                "content": [],
                "model": state.model,
                "stop_reason": null,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": state.input_tokens,
                    "output_tokens": state.output_tokens,
                },
            },
        }),
    )
}

fn anthropic_finish(state: &mut AnthropicStreamState, reason: Option<&str>) -> String {
    if state.finished {
        return String::new();
    }
    state.finished = true;
    let reason = reason
        .map(|reason| compat::anthropic::stop_reason_to_anthropic(Some(reason)))
        .or_else(|| {
            state
                .saw_tool_call
                .then_some("tool_use")
                .or(Some("end_turn"))
        })
        .unwrap_or("end_turn");
    state.stop_reason = Some(reason.to_string());

    let mut output = String::new();
    if let Some(index) = state.text_block_index {
        output.push_str(&anthropic_event(
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": index }),
        ));
    }
    for block in &state.tool_blocks {
        if block.started && !block.closed {
            output.push_str(&anthropic_event(
                "content_block_stop",
                json!({ "type": "content_block_stop", "index": block.anthropic_index }),
            ));
        }
    }
    output.push_str(&anthropic_event(
        "message_delta",
        json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": reason,
                "stop_sequence": null,
            },
            "usage": { "output_tokens": state.output_tokens },
        }),
    ));
    output.push_str(&anthropic_event(
        "message_stop",
        json!({ "type": "message_stop" }),
    ));
    output
}

fn anthropic_chunk_events(state: &mut AnthropicStreamState, chunk: &Value) -> String {
    if state.finished {
        return String::new();
    }
    let mut output = anthropic_start(state, chunk);
    let choice = &chunk["choices"][0];
    let delta = &choice["delta"];

    if let Some(usage) = chunk.get("usage") {
        state.input_tokens = usage["prompt_tokens"]
            .as_u64()
            .unwrap_or(state.input_tokens);
        state.output_tokens = usage["completion_tokens"]
            .as_u64()
            .unwrap_or(state.output_tokens);
    }

    if let Some(text) = delta["content"].as_str().filter(|text| !text.is_empty()) {
        let mut closed_tool_blocks = String::new();
        for block in &mut state.tool_blocks {
            if block.started && !block.closed {
                closed_tool_blocks.push_str(&anthropic_event(
                    "content_block_stop",
                    json!({ "type": "content_block_stop", "index": block.anthropic_index }),
                ));
                block.closed = true;
            }
        }
        output.push_str(&closed_tool_blocks);
        let index = *state.text_block_index.get_or_insert_with(|| {
            let index = state.next_block_index;
            state.next_block_index += 1;
            output.push_str(&anthropic_event(
                "content_block_start",
                json!({
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "text", "text": "" },
                }),
            ));
            index
        });
        output.push_str(&anthropic_event(
            "content_block_delta",
            json!({
                "type": "content_block_delta",
                "index": index,
                "delta": { "type": "text_delta", "text": text },
            }),
        ));
    }

    if let Some(calls) = delta["tool_calls"].as_array() {
        state.saw_tool_call = true;
        if let Some(index) = state.text_block_index.take() {
            output.push_str(&anthropic_event(
                "content_block_stop",
                json!({ "type": "content_block_stop", "index": index }),
            ));
        }
        for (position, call) in calls.iter().enumerate() {
            let openai_index = call["index"].as_u64().unwrap_or(position as u64);
            let tool_position = state
                .tool_blocks
                .iter()
                .position(|block| block.openai_index == openai_index);
            let block_position = match tool_position {
                Some(position) => position,
                None => {
                    let index = state.next_block_index;
                    state.next_block_index += 1;
                    state.tool_blocks.push(AnthropicToolBlock {
                        openai_index,
                        anthropic_index: index,
                        id: String::new(),
                        name: String::new(),
                        started: false,
                        closed: false,
                    });
                    state.tool_blocks.len() - 1
                }
            };
            let block = &mut state.tool_blocks[block_position];
            if let Some(id) = call["id"].as_str() {
                block.id = id.to_string();
            }
            if let Some(name) = call["function"]["name"].as_str() {
                block.name = name.to_string();
            }
            if !block.started {
                block.started = true;
                let id = if block.id.is_empty() {
                    format!("toolu_compat_{}", block.openai_index)
                } else {
                    block.id.clone()
                };
                let name = if block.name.is_empty() {
                    "unknown".to_string()
                } else {
                    block.name.clone()
                };
                output.push_str(&anthropic_event(
                    "content_block_start",
                    json!({
                        "type": "content_block_start",
                        "index": block.anthropic_index,
                        "content_block": {
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": {},
                        },
                    }),
                ));
            }
            if let Some(arguments) = call["function"]["arguments"].as_str() {
                if !arguments.is_empty() {
                    output.push_str(&anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": block.anthropic_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": arguments,
                            },
                        }),
                    ));
                }
            }
        }
    }

    if let Some(reason) = choice["finish_reason"].as_str() {
        output.push_str(&anthropic_finish(state, Some(reason)));
    }
    output
}

fn translate_openai_stream_to_anthropic(
    body: axum::body::Body,
) -> impl Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    use futures_util::stream;

    let inner = body.into_data_stream();
    stream::unfold(
        (inner, Vec::<u8>::new(), AnthropicStreamState::default()),
        |(mut inner, mut pending, mut state)| async move {
            loop {
                match inner.next().await {
                    Some(Ok(bytes)) => {
                        pending.extend_from_slice(&bytes);
                        let split_at = match pending.iter().rposition(|byte| *byte == b'\n') {
                            Some(index) => index + 1,
                            None => continue,
                        };
                        let ready: Vec<u8> = pending.drain(..split_at).collect();
                        let mut output = String::new();
                        for line in String::from_utf8_lossy(&ready).lines() {
                            let Some(data) = line.trim().strip_prefix("data:") else {
                                continue;
                            };
                            let data = data.trim();
                            if data == "[DONE]" {
                                output.push_str(&anthropic_finish(&mut state, None));
                            } else if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                                output.push_str(&anthropic_chunk_events(&mut state, &chunk));
                            }
                        }
                        if !output.is_empty() {
                            return Some((Ok(bytes::Bytes::from(output)), (inner, pending, state)));
                        }
                    }
                    Some(Err(error)) => {
                        return Some((
                            Err(std::io::Error::other(error.to_string())),
                            (inner, pending, state),
                        ));
                    }
                    None => {
                        if !pending.is_empty() {
                            let ready = String::from_utf8_lossy(&pending).to_string();
                            pending.clear();
                            if let Some(data) = ready.trim().strip_prefix("data:") {
                                if let Ok(chunk) = serde_json::from_str::<Value>(data.trim()) {
                                    let output = anthropic_chunk_events(&mut state, &chunk);
                                    if !output.is_empty() {
                                        return Some((
                                            Ok(bytes::Bytes::from(output)),
                                            (inner, pending, state),
                                        ));
                                    }
                                }
                            }
                        }
                        let output = anthropic_finish(&mut state, None);
                        if !output.is_empty() {
                            return Some((Ok(bytes::Bytes::from(output)), (inner, pending, state)));
                        }
                        return None;
                    }
                }
            }
        },
    )
}

#[derive(Default)]
struct GeminiStreamState {
    finished: bool,
    saw_tool_call: bool,
    tool_calls: Vec<GeminiToolCall>,
}

struct GeminiToolCall {
    index: u64,
    name: String,
    arguments: String,
    emitted: bool,
}

fn gemini_stream_event(state: &mut GeminiStreamState, chunk: &Value) -> Option<String> {
    if state.finished {
        return None;
    }
    let choice = &chunk["choices"][0];
    let delta = &choice["delta"];
    let mut parts = Vec::new();
    if let Some(text) = delta["content"].as_str().filter(|text| !text.is_empty()) {
        parts.push(json!({ "text": text }));
    }
    if let Some(calls) = delta["tool_calls"].as_array() {
        state.saw_tool_call = true;
        for (position, call) in calls.iter().enumerate() {
            let index = call["index"].as_u64().unwrap_or(position as u64);
            let call_state = if let Some(existing) =
                state.tool_calls.iter_mut().find(|call| call.index == index)
            {
                existing
            } else {
                state.tool_calls.push(GeminiToolCall {
                    index,
                    name: String::new(),
                    arguments: String::new(),
                    emitted: false,
                });
                state
                    .tool_calls
                    .last_mut()
                    .expect("tool call was just pushed")
            };
            if let Some(name) = call["function"]["name"].as_str() {
                call_state.name = name.to_string();
            }
            if let Some(arguments) = call["function"]["arguments"].as_str() {
                call_state.arguments.push_str(arguments);
            }
            if !call_state.emitted {
                if let Ok(args) = serde_json::from_str::<Value>(&call_state.arguments) {
                    parts.push(json!({
                        "functionCall": {
                            "name": call_state.name,
                            "args": args,
                        },
                    }));
                    call_state.emitted = true;
                }
            }
        }
    }

    let reason = choice["finish_reason"].as_str();
    if reason.is_some() {
        for call in &mut state.tool_calls {
            if call.emitted {
                continue;
            }
            parts.push(json!({
                "functionCall": {
                    "name": call.name,
                    "args": compat::gemini::parse_json_arguments(&Value::String(call.arguments.clone())),
                },
            }));
            call.emitted = true;
        }
    }
    if parts.is_empty() && reason.is_none() && chunk.get("usage").is_none() {
        return None;
    }

    let mut candidate = json!({
        "content": { "role": "model", "parts": parts },
    });
    if let Some(reason) = reason {
        state.finished = true;
        candidate["finishReason"] =
            Value::String(compat::gemini::finish_reason_to_gemini(Some(reason)).to_string());
    }
    let mut response = json!({ "candidates": [candidate] });
    if let Some(usage) = chunk.get("usage") {
        response["usageMetadata"] = json!({
            "promptTokenCount": usage["prompt_tokens"].as_u64().unwrap_or(0),
            "candidatesTokenCount": usage["completion_tokens"].as_u64().unwrap_or(0),
            "totalTokenCount": usage["total_tokens"].as_u64().unwrap_or(0),
        });
    }
    Some(format!("data: {response}\n\n"))
}

fn gemini_finish(state: &mut GeminiStreamState) -> Option<String> {
    if state.finished {
        return None;
    }
    state.finished = true;
    let reason = if state.saw_tool_call {
        "tool_calls"
    } else {
        "stop"
    };
    Some(format!(
        "data: {}\n\n",
        json!({
            "candidates": [{
                "content": { "role": "model", "parts": [] },
                "finishReason": compat::gemini::finish_reason_to_gemini(Some(reason)),
            }],
        })
    ))
}

/// Translate the pipeline's OpenAI SSE byte stream into Gemini
/// `streamGenerateContent` chunks. Finish metadata is emitted only on the
/// terminal candidate, and tool-call fragments are accumulated until their
/// arguments form a Gemini object.
fn translate_openai_stream_to_gemini(
    body: axum::body::Body,
) -> impl Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    use futures_util::stream;

    let inner = body.into_data_stream();
    stream::unfold(
        (inner, Vec::<u8>::new(), GeminiStreamState::default()),
        |(mut inner, mut pending, mut state)| async move {
            loop {
                match inner.next().await {
                    Some(Ok(bytes)) => {
                        pending.extend_from_slice(&bytes);
                        let split_at = match pending.iter().rposition(|byte| *byte == b'\n') {
                            Some(index) => index + 1,
                            None => continue,
                        };
                        let ready: Vec<u8> = pending.drain(..split_at).collect();
                        let mut output = String::new();
                        for line in String::from_utf8_lossy(&ready).lines() {
                            let Some(data) = line.trim().strip_prefix("data:") else {
                                continue;
                            };
                            let data = data.trim();
                            if data == "[DONE]" {
                                if let Some(event) = gemini_finish(&mut state) {
                                    output.push_str(&event);
                                }
                            } else if let Ok(chunk) = serde_json::from_str::<Value>(data) {
                                if let Some(event) = gemini_stream_event(&mut state, &chunk) {
                                    output.push_str(&event);
                                }
                            }
                        }
                        if !output.is_empty() {
                            return Some((Ok(bytes::Bytes::from(output)), (inner, pending, state)));
                        }
                    }
                    Some(Err(error)) => {
                        return Some((
                            Err(std::io::Error::other(error.to_string())),
                            (inner, pending, state),
                        ));
                    }
                    None => {
                        if !pending.is_empty() {
                            let ready = String::from_utf8_lossy(&pending).to_string();
                            pending.clear();
                            if let Some(data) = ready.trim().strip_prefix("data:") {
                                if let Ok(chunk) = serde_json::from_str::<Value>(data.trim()) {
                                    if let Some(event) = gemini_stream_event(&mut state, &chunk) {
                                        return Some((
                                            Ok(bytes::Bytes::from(event)),
                                            (inner, pending, state),
                                        ));
                                    }
                                }
                            }
                        }
                        if let Some(event) = gemini_finish(&mut state) {
                            return Some((Ok(bytes::Bytes::from(event)), (inner, pending, state)));
                        }
                        return None;
                    }
                }
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compat_auth_accepts_standard_headers_and_query_fallback() {
        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", HeaderValue::from_static("anthropic-key"));
        assert_eq!(
            compat_api_key(&headers, Some("query-key")),
            Some("anthropic-key")
        );

        headers.insert("authorization", HeaderValue::from_static("Bearer auth-key"));
        assert_eq!(
            compat_api_key(&headers, Some("query-key")),
            Some("Bearer auth-key")
        );

        headers.remove("authorization");
        headers.remove("x-api-key");
        headers.insert("x-goog-api-key", HeaderValue::from_static("gemini-key"));
        assert_eq!(
            compat_api_key(&headers, Some("query-key")),
            Some("gemini-key")
        );

        headers.remove("x-goog-api-key");
        assert_eq!(
            compat_api_key(&headers, Some("query-key")),
            Some("query-key")
        );
    }

    #[test]
    fn anthropic_stream_has_stateful_message_and_text_framing() {
        let mut state = AnthropicStreamState::default();
        let start = anthropic_chunk_events(
            &mut state,
            &json!({
                "id": "chatcmpl_1",
                "model": "gpt-compat",
                "choices": [{ "delta": { "role": "assistant" }, "finish_reason": null }],
            }),
        );
        let text = anthropic_chunk_events(
            &mut state,
            &json!({ "choices": [{ "delta": { "content": "Hello" }, "finish_reason": null }] }),
        );
        let terminal = anthropic_chunk_events(
            &mut state,
            &json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] }),
        );

        assert!(start.contains("event: message_start"));
        assert!(text.contains("event: content_block_start"));
        assert!(text.contains("\"type\":\"text_delta\""));
        assert!(terminal.contains("event: content_block_stop"));
        assert!(terminal.contains("\"stop_reason\":\"end_turn\""));
        assert!(terminal.contains("event: message_stop"));
        assert!(!text.contains("finishReason"));
    }

    #[test]
    fn anthropic_stream_projects_tool_call_deltas() {
        let mut state = AnthropicStreamState::default();
        let events = anthropic_chunk_events(
            &mut state,
            &json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": "call_1",
                            "type": "function",
                            "function": { "name": "lookup", "arguments": "{\"q\":" },
                        }]
                    },
                    "finish_reason": null,
                }],
            }),
        );
        let terminal = anthropic_chunk_events(
            &mut state,
            &json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] }),
        );

        assert!(events.contains("\"type\":\"tool_use\""));
        assert!(events.contains("\"type\":\"input_json_delta\""));
        assert!(terminal.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn gemini_stream_keeps_deltas_unfinished_until_terminal_chunk() {
        let mut state = GeminiStreamState::default();
        let text = gemini_stream_event(
            &mut state,
            &json!({ "choices": [{ "delta": { "content": "Hello" }, "finish_reason": null }] }),
        )
        .expect("text chunk should be emitted");
        assert!(text.contains("\"text\":\"Hello\""));
        assert!(!text.contains("finishReason"));

        let tool = gemini_stream_event(
            &mut state,
            &json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": { "name": "lookup", "arguments": "{\"q\":\"x\"}" },
                        }]
                    },
                    "finish_reason": "tool_calls",
                }],
            }),
        )
        .expect("tool chunk should be emitted");
        assert!(tool.contains("functionCall"));
        assert!(tool.contains("\"finishReason\":\"STOP\""));
        assert!(gemini_finish(&mut state).is_none());
    }

    #[tokio::test]
    async fn stream_translators_consume_openai_sse_fixtures() {
        let fixture = concat!(
            "data: {\"id\":\"chatcmpl_1\",\"model\":\"compat\",\"choices\":[{\"delta\":{\"content\":\"Hi\"},\"finish_reason\":null}]}\n\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n",
            "data: [DONE]\n\n",
        );

        let anthropic_stream =
            translate_openai_stream_to_anthropic(axum::body::Body::from(fixture));
        futures_util::pin_mut!(anthropic_stream);
        let mut anthropic = String::new();
        while let Some(Ok(chunk)) = anthropic_stream.next().await {
            anthropic.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert!(anthropic.contains("event: message_start"));
        assert!(anthropic.contains("event: message_stop"));
        assert!(anthropic.contains("\"output_tokens\":2"));
        assert_eq!(anthropic.matches("event: message_stop").count(), 1);

        let gemini_stream = translate_openai_stream_to_gemini(axum::body::Body::from(fixture));
        futures_util::pin_mut!(gemini_stream);
        let mut gemini = String::new();
        while let Some(Ok(chunk)) = gemini_stream.next().await {
            gemini.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert!(gemini.contains("\"text\":\"Hi\""));
        assert!(gemini.contains("\"finishReason\":\"STOP\""));
        assert!(gemini.contains("\"usageMetadata\""));
        assert!(gemini.contains("\"candidatesTokenCount\":2"));
        assert_eq!(gemini.matches("\"finishReason\"").count(), 1);
    }
}
