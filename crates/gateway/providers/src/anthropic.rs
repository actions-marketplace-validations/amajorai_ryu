use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use serde_json::{json, Value};
use tracing::{debug, warn};

use crate::{error::ProviderError, quota::ProviderQuotas};

use super::{parse_rate_limit, Provider};

pub struct AnthropicProvider {
    client: reqwest::Client,
    /// Account rotation set (#4). See `OpenAiProvider::keys`.
    keys: Vec<String>,
    cursor: AtomicUsize,
    base_url: String,
    quota: Arc<ProviderQuotas>,
}

impl AnthropicProvider {
    pub fn new(
        client: reqwest::Client,
        keys: Vec<String>,
        base_url: String,
        quota: Arc<ProviderQuotas>,
    ) -> Self {
        Self {
            client,
            keys,
            cursor: AtomicUsize::new(0),
            base_url,
            quota,
        }
    }

    /// The next account key in round-robin order.
    fn next_key(&self) -> String {
        let n = self.keys.len();
        if n <= 1 {
            return self.keys.first().cloned().unwrap_or_default();
        }
        let i = self.cursor.fetch_add(1, Ordering::Relaxed) % n;
        self.keys[i].clone()
    }

    fn messages_url(&self) -> String {
        format!("{}/v1/messages", self.base_url.trim_end_matches('/'))
    }

    /// A `POST /v1/messages` builder carrying the auth and version headers every
    /// Anthropic call needs, plus the extended-cache-TTL beta when — and only
    /// when — the payload actually asks for a non-default `cache_control.ttl`.
    fn anthropic_post(&self, url: &str, key: &str, payload: &Value) -> reqwest::RequestBuilder {
        let mut req = self
            .client
            .post(url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01");
        if wants_extended_cache_ttl(payload) {
            req = req.header("anthropic-beta", EXTENDED_CACHE_TTL_BETA);
        }
        req.json(payload)
    }

    /// Convert an OpenAI-format chat request body into an Anthropic messages body.
    fn to_anthropic_body(&self, model: &str, body: &Value) -> Value {
        let messages = body["messages"].as_array().cloned().unwrap_or_default();

        // Non-system messages become the messages array
        let filtered_messages: Vec<Value> = messages
            .iter()
            .filter(|m| m["role"].as_str() != Some("system"))
            .map(|m| {
                // Normalise content: Anthropic accepts a string or content-block array.
                // If the OpenAI message already has a string content, pass it through.
                // Block arrays pass through verbatim, so a per-block
                // `cache_control` breakpoint on a user/assistant turn survives.
                json!({
                    "role": m["role"],
                    "content": m["content"],
                })
            })
            .collect();

        // Anthropic requires max_tokens; fall back to 4096 if not provided.
        let max_tokens = body["max_tokens"].as_u64().unwrap_or(4096);

        let mut req = json!({
            "model": model,
            "messages": filtered_messages,
            "max_tokens": max_tokens,
        });

        // System messages hoist to Anthropic's top-level `system` field.
        if let Some(system) = system_field(&messages) {
            req["system"] = system;
        }

        // Forward optional parameters
        if let Some(t) = body.get("temperature") {
            req["temperature"] = t.clone();
        }
        if let Some(p) = body.get("top_p") {
            req["top_p"] = p.clone();
        }
        if let Some(s) = body.get("stop") {
            // Anthropic uses "stop_sequences" as an array
            match s {
                Value::String(str_val) => {
                    req["stop_sequences"] = json!([str_val]);
                }
                Value::Array(_) => {
                    req["stop_sequences"] = s.clone();
                }
                _ => {}
            }
        }

        req
    }

    /// Convert an Anthropic messages response into an OpenAI chat completion response.
    fn from_anthropic_response(&self, resp: &Value, requested_model: &str) -> Value {
        let content = resp["content"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|b| b["text"].as_str())
            .unwrap_or_default();

        let stop_reason = match resp["stop_reason"].as_str() {
            Some("end_turn") => "stop",
            Some("max_tokens") => "length",
            Some("tool_use") => "tool_calls",
            _ => "stop",
        };

        let cache = CacheUsage::from_anthropic(&resp["usage"]);
        // Anthropic reports `input_tokens` *excluding* whatever it served from or
        // wrote to the prompt cache, while OpenAI's `prompt_tokens` includes it.
        // Add the cache legs back so downstream token accounting (and any cost
        // model keyed on `prompt_tokens`) sees the true prompt size.
        //
        // This correction belongs to the NATIVE Anthropic `/v1/messages` shape
        // only. Do not mirror it onto the OpenAI-compatible path (OpenRouter):
        // there `prompt_tokens` already includes `cached_tokens`, so adding them
        // again would double-count the prompt.
        let input_tokens = resp["usage"]["input_tokens"].as_u64().unwrap_or(0) + cache.total();
        let output_tokens = resp["usage"]["output_tokens"].as_u64().unwrap_or(0);

        let mut out = json!({
            "id": resp["id"].as_str().unwrap_or("msg_unknown"),
            "object": "chat.completion",
            "created": chrono::Utc::now().timestamp(),
            "model": requested_model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": stop_reason,
                "logprobs": null,
            }],
            "usage": {
                "prompt_tokens": input_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }
        });
        cache.merge_into_usage(&mut out["usage"]);
        out
    }
}

/// Prompt-cache read/write token counts lifted off a provider `usage` block.
///
/// Anthropic names these `cache_read_input_tokens` / `cache_creation_input_tokens`;
/// the OpenAI-compatible shape (what OpenRouter and this gateway's own pipeline
/// read) names them `prompt_tokens_details.{cached_tokens,cache_write_tokens}`.
/// This carries the pair between the two vocabularies.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CacheUsage {
    /// Prompt tokens served from the provider's cache (a cache *read*).
    pub read: u64,
    /// Prompt tokens written into the provider's cache (a cache *write* — billed
    /// above the normal input rate, which is why it is reported separately).
    pub write: u64,
}

impl CacheUsage {
    /// Read the Anthropic-native field names off a `usage` object.
    pub(crate) fn from_anthropic(usage: &Value) -> Self {
        Self {
            read: usage["cache_read_input_tokens"].as_u64().unwrap_or(0),
            write: usage["cache_creation_input_tokens"].as_u64().unwrap_or(0),
        }
    }

    pub(crate) fn total(self) -> u64 {
        self.read + self.write
    }

    pub(crate) fn is_zero(self) -> bool {
        self.total() == 0
    }

    /// Stamp both vocabularies onto an OpenAI-shaped `usage` object. A no-op when
    /// the provider reported no caching, so a non-caching response keeps exactly
    /// the wire shape it had before prompt-cache support existed.
    pub(crate) fn merge_into_usage(self, usage: &mut Value) {
        if self.is_zero() {
            return;
        }
        usage["prompt_tokens_details"] = json!({
            "cached_tokens": self.read,
            "cache_write_tokens": self.write,
        });
        // Native names too, so an Anthropic-aware caller reading through the
        // gateway sees the same fields it would get talking to Anthropic direct.
        usage["cache_read_input_tokens"] = json!(self.read);
        usage["cache_creation_input_tokens"] = json!(self.write);
    }
}

/// Build Anthropic's top-level `system` value from the OpenAI-shape system
/// messages.
///
/// Returns `None` when there are no system messages. When every block is plain
/// text with no `cache_control`, the blocks are joined into a single string —
/// the exact wire shape this adapter has always produced. As soon as any block
/// carries a `cache_control` breakpoint (or is not a plain text block), the
/// array form is emitted instead, because a string `system` cannot carry one.
///
/// This is also a plain correctness fix: the previous `filter_map(as_str)` threw
/// away *any* array-form system content, silently dropping the whole system
/// prompt for callers that send content blocks.
fn system_field(messages: &[Value]) -> Option<Value> {
    let mut blocks: Vec<Value> = Vec::new();
    for m in messages.iter().filter(|m| m["role"].as_str() == Some("system")) {
        blocks.extend(content_blocks(&m["content"]));
    }
    if blocks.is_empty() {
        return None;
    }

    // `collect::<Option<Vec<_>>>` short-circuits to `None` the moment one block
    // is not plain cache-free text, which is exactly when we need the array form.
    let plain: Option<Vec<&str>> = blocks
        .iter()
        .map(|b| {
            let plain_text = b.get("cache_control").is_none() && b["type"] == json!("text");
            plain_text.then(|| b["text"].as_str()).flatten()
        })
        .collect();

    Some(match plain {
        Some(parts) => Value::String(parts.join("\n\n")),
        None => Value::Array(blocks),
    })
}

/// Normalise one OpenAI-shape message `content` into Anthropic content blocks.
/// A plain string becomes a single `text` block; an array passes through
/// block-by-block so per-block `cache_control` breakpoints survive.
fn content_blocks(content: &Value) -> Vec<Value> {
    match content {
        Value::String(s) => vec![json!({ "type": "text", "text": s })],
        Value::Array(items) => items.clone(),
        _ => Vec::new(),
    }
}

/// Whether any `cache_control` breakpoint in the outgoing payload asks for a TTL
/// other than Anthropic's 5-minute default. Those require an opt-in beta header,
/// and without it Anthropic rejects the request rather than silently downgrading
/// — so the header is sent if and only if an extended TTL is actually present.
fn wants_extended_cache_ttl(payload: &Value) -> bool {
    fn walk(v: &Value) -> bool {
        match v {
            Value::Object(map) => {
                if let Some(ttl) = map.get("cache_control").and_then(|c| c.get("ttl")) {
                    if ttl.as_str().is_some_and(|t| t != "5m") {
                        return true;
                    }
                }
                map.values().any(walk)
            }
            Value::Array(items) => items.iter().any(walk),
            _ => false,
        }
    }
    walk(payload)
}

/// Anthropic's opt-in beta for `cache_control.ttl` values beyond the 5-minute
/// default (currently `"1h"`).
const EXTENDED_CACHE_TTL_BETA: &str = "extended-cache-ttl-2025-04-11";

impl Provider for AnthropicProvider {
    fn name(&self) -> &'static str {
        "anthropic"
    }

    fn complete<'a>(
        &'a self,
        model: &'a str,
        body: &'a Value,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<Value, ProviderError>> + Send + 'a>> {
        Box::pin(async move {
            let payload = self.to_anthropic_body(model, body);
            debug!(
                provider = "anthropic",
                model, "sending non-streaming request"
            );

            let url = self.messages_url();
            // Account rotation (#4): rotate keys on a 429 before failing over.
            let attempts = self.keys.len().max(1);
            let mut last_err: Option<ProviderError> = None;
            for _ in 0..attempts {
                let key = self.next_key();
                let resp = self
                    .anthropic_post(&url, &key, &payload)
                    .send()
                    .await
                    .map_err(|e| {
                        ProviderError::Provider(format!("Anthropic request failed: {e}"))
                    })?;

                let status = resp.status();
                let rate_limit = parse_rate_limit(resp.headers());

                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let retry_after = rate_limit.as_ref().and_then(|r| r.retry_after);
                    let reset_at = rate_limit.as_ref().and_then(|r| r.reset_at);
                    self.quota
                        .record_rate_limited("anthropic", retry_after, reset_at);
                    let _ = resp.text().await;
                    warn!(provider = "anthropic", "provider rate limited (429)");
                    let e = ProviderError::RateLimited {
                        provider: "anthropic".to_string(),
                        retry_after,
                        reset_at,
                    };
                    if attempts > 1 {
                        last_err = Some(e);
                        continue;
                    }
                    return Err(e);
                }

                let json: Value = resp.json().await.map_err(|e| {
                    ProviderError::Provider(format!("Anthropic response parse error: {e}"))
                })?;

                if !status.is_success() {
                    let msg = json["error"]["message"]
                        .as_str()
                        .unwrap_or("unknown error")
                        .to_string();
                    warn!(provider = "anthropic", status = %status, error = %msg, "provider returned error");
                    return Err(ProviderError::Provider(format!(
                        "Anthropic error {status}: {msg}"
                    )));
                }

                if let Some(info) = rate_limit.as_ref() {
                    self.quota.record_success("anthropic", info);
                }

                // Requested model (before routing) for response shaping
                let requested_model = body["model"].as_str().unwrap_or(model);
                return Ok(self.from_anthropic_response(&json, requested_model));
            }
            Err(last_err.unwrap_or_else(|| ProviderError::RateLimited {
                provider: "anthropic".to_string(),
                retry_after: None,
                reset_at: None,
            }))
        })
    }

    fn complete_stream<'a>(
        &'a self,
        model: &'a str,
        body: &'a Value,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<Body, ProviderError>> + Send + 'a>> {
        Box::pin(async move {
            let mut payload = self.to_anthropic_body(model, body);
            payload["stream"] = Value::Bool(true);
            debug!(provider = "anthropic", model, "sending streaming request");

            let url = self.messages_url();
            let attempts = self.keys.len().max(1);
            let mut last_err: Option<ProviderError> = None;
            for _ in 0..attempts {
                let key = self.next_key();
                let resp = self
                    .anthropic_post(&url, &key, &payload)
                    .send()
                    .await
                    .map_err(|e| {
                        ProviderError::Provider(format!("Anthropic stream request failed: {e}"))
                    })?;

                let status = resp.status();
                let rate_limit = parse_rate_limit(resp.headers());

                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let retry_after = rate_limit.as_ref().and_then(|r| r.retry_after);
                    let reset_at = rate_limit.as_ref().and_then(|r| r.reset_at);
                    self.quota
                        .record_rate_limited("anthropic", retry_after, reset_at);
                    let _ = resp.text().await;
                    let e = ProviderError::RateLimited {
                        provider: "anthropic".to_string(),
                        retry_after,
                        reset_at,
                    };
                    if attempts > 1 {
                        last_err = Some(e);
                        continue;
                    }
                    return Err(e);
                }

                if !status.is_success() {
                    let text = resp.text().await.unwrap_or_default();
                    return Err(ProviderError::Provider(format!(
                        "Anthropic stream error {status}: {text}"
                    )));
                }

                if let Some(info) = rate_limit.as_ref() {
                    self.quota.record_success("anthropic", info);
                }

                let requested_model = body["model"].as_str().unwrap_or(model).to_string();

                // Translate Anthropic SSE events → OpenAI SSE events on the fly.
                let raw_stream = resp.bytes_stream();
                let translated = translate_anthropic_stream(raw_stream, requested_model);
                return Ok(Body::from_stream(translated));
            }
            Err(last_err.unwrap_or_else(|| ProviderError::RateLimited {
                provider: "anthropic".to_string(),
                retry_after: None,
                reset_at: None,
            }))
        })
    }
}

/// Translate an Anthropic streaming SSE response into OpenAI-compatible SSE chunks.
///
/// Anthropic events look like:
///   event: content_block_delta
///   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}
///
/// We emit OpenAI-style:
///   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"hello"},"index":0}]}
///   data: [DONE]
fn translate_anthropic_stream(
    raw: impl futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
    model: String,
) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static {
    use futures_util::stream;

    let completion_id = format!("chatcmpl-{}", uuid::Uuid::new_v4().simple());
    let created = chrono::Utc::now().timestamp();

    let mut last_event_type = String::new();
    // Usage is spread across two Anthropic events: `message_start` carries the
    // input legs (including the prompt-cache read/write counts) and
    // `message_delta` carries the running output count. Accumulate both so the
    // terminal OpenAI chunk can report a usage block — without one, the
    // gateway's `sse_parse_usage` / `sse_parse_cached_tokens` see nothing and
    // streaming token and cache accounting on this path is blind.
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache = CacheUsage::default();
    // Anthropic sends both `message_delta` and `message_stop`; emit the terminal
    // chunk (and `[DONE]`) exactly once.
    let mut finished = false;
    let cid = completion_id.clone();

    raw.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        .flat_map(move |chunk_result| {
            let cid = cid.clone();
            let model = model.clone();

            match chunk_result {
                Err(e) => stream::iter(vec![Err(e)]).left_stream(),
                Ok(chunk) => {
                    let text = match std::str::from_utf8(&chunk) {
                        Ok(t) => t.to_string(),
                        Err(_) => return stream::iter(vec![]).left_stream(),
                    };

                    let mut output: Vec<Result<Bytes, std::io::Error>> = Vec::new();

                    for line in text.lines() {
                        if line.starts_with("event: ") {
                            last_event_type = line[7..].trim().to_string();
                        } else if line.starts_with("data: ") {
                            let data = &line[6..];

                            match last_event_type.as_str() {
                                "content_block_delta" => {
                                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                                        if let Some(text) = v["delta"]["text"].as_str() {
                                            let oai_chunk = serde_json::json!({
                                                "id": cid,
                                                "object": "chat.completion.chunk",
                                                "created": created,
                                                "model": model,
                                                "choices": [{
                                                    "index": 0,
                                                    "delta": {"content": text},
                                                    "finish_reason": null,
                                                }]
                                            });
                                            if let Ok(json_str) = serde_json::to_string(&oai_chunk)
                                            {
                                                let line = format!("data: {json_str}\n\n");
                                                output.push(Ok(Bytes::from(line)));
                                            }
                                        }
                                    }
                                }
                                "message_start" => {
                                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                                        let usage = &v["message"]["usage"];
                                        input_tokens = usage["input_tokens"].as_u64().unwrap_or(0);
                                        cache = CacheUsage::from_anthropic(usage);
                                    }
                                }
                                "message_stop" | "message_delta" => {
                                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                                        if let Some(n) = v["usage"]["output_tokens"].as_u64() {
                                            output_tokens = n;
                                        }
                                    }
                                    if finished {
                                        continue;
                                    }
                                    finished = true;
                                    // Same `input_tokens` correction as the
                                    // non-streaming path: Anthropic excludes the
                                    // cache legs, OpenAI's `prompt_tokens` includes them.
                                    let prompt_tokens = input_tokens + cache.total();
                                    let mut usage = serde_json::json!({
                                        "prompt_tokens": prompt_tokens,
                                        "completion_tokens": output_tokens,
                                        "total_tokens": prompt_tokens + output_tokens,
                                    });
                                    cache.merge_into_usage(&mut usage);
                                    let stop_chunk = serde_json::json!({
                                        "id": cid,
                                        "object": "chat.completion.chunk",
                                        "created": created,
                                        "model": model,
                                        "choices": [{
                                            "index": 0,
                                            "delta": {},
                                            "finish_reason": "stop",
                                        }],
                                        "usage": usage,
                                    });
                                    if let Ok(json_str) = serde_json::to_string(&stop_chunk) {
                                        let line = format!("data: {json_str}\n\ndata: [DONE]\n\n");
                                        output.push(Ok(Bytes::from(line)));
                                    }
                                }
                                _ => {}
                            }
                        }
                    }

                    stream::iter(output).right_stream()
                }
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockResponse, MockServer};
    use futures_util::StreamExt;
    use std::sync::Arc;

    fn provider_with(base_url: String, keys: Vec<&str>) -> AnthropicProvider {
        AnthropicProvider::new(
            reqwest::Client::new(),
            keys.into_iter().map(String::from).collect(),
            base_url,
            Arc::new(ProviderQuotas::new()),
        )
    }

    fn dummy() -> AnthropicProvider {
        provider_with("http://127.0.0.1:1".to_string(), vec!["k"])
    }

    #[test]
    fn to_anthropic_body_hoists_system_and_sets_max_tokens_default() {
        let p = dummy();
        let body = json!({
            "messages": [
                { "role": "system", "content": "be terse" },
                { "role": "user", "content": "hi" }
            ]
        });
        let out = p.to_anthropic_body("claude-3", &body);
        assert_eq!(out["model"], json!("claude-3"));
        assert_eq!(out["system"], json!("be terse"));
        // System message is filtered out of the messages array.
        assert_eq!(out["messages"].as_array().unwrap().len(), 1);
        assert_eq!(out["messages"][0]["role"], json!("user"));
        // Anthropic requires max_tokens; default is 4096 when unset.
        assert_eq!(out["max_tokens"], json!(4096));
    }

    #[test]
    fn to_anthropic_body_joins_multiple_system_messages() {
        let p = dummy();
        let body = json!({
            "messages": [
                { "role": "system", "content": "one" },
                { "role": "system", "content": "two" },
                { "role": "user", "content": "hi" }
            ],
            "max_tokens": 100
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(out["system"], json!("one\n\ntwo"));
        assert_eq!(out["max_tokens"], json!(100));
    }

    #[test]
    fn to_anthropic_body_maps_stop_string_and_forwards_sampling() {
        let p = dummy();
        let body = json!({
            "messages": [{ "role": "user", "content": "hi" }],
            "temperature": 0.7,
            "top_p": 0.9,
            "stop": "STOP"
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(out["temperature"], json!(0.7));
        assert_eq!(out["top_p"], json!(0.9));
        // A string `stop` becomes a single-element `stop_sequences` array.
        assert_eq!(out["stop_sequences"], json!(["STOP"]));
        // No system message → no `system` field.
        assert!(out.get("system").is_none());
    }

    #[test]
    fn to_anthropic_body_passes_stop_array_through() {
        let p = dummy();
        let body = json!({
            "messages": [{ "role": "user", "content": "hi" }],
            "stop": ["A", "B"]
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(out["stop_sequences"], json!(["A", "B"]));
    }

    #[test]
    fn from_anthropic_response_maps_content_and_usage_and_stop_reason() {
        let p = dummy();
        let resp = json!({
            "id": "msg_42",
            "content": [{ "type": "text", "text": "hello world" }],
            "stop_reason": "max_tokens",
            "usage": { "input_tokens": 10, "output_tokens": 7 }
        });
        let out = p.from_anthropic_response(&resp, "gpt-4o-alias");
        assert_eq!(out["id"], json!("msg_42"));
        assert_eq!(out["object"], json!("chat.completion"));
        assert_eq!(out["model"], json!("gpt-4o-alias"));
        assert_eq!(out["choices"][0]["message"]["content"], json!("hello world"));
        // max_tokens → OpenAI "length".
        assert_eq!(out["choices"][0]["finish_reason"], json!("length"));
        assert_eq!(out["usage"]["prompt_tokens"], json!(10));
        assert_eq!(out["usage"]["completion_tokens"], json!(7));
        assert_eq!(out["usage"]["total_tokens"], json!(17));
    }

    #[test]
    fn from_anthropic_response_stop_reason_variants() {
        let p = dummy();
        let mk = |reason: &str| {
            json!({ "content": [{ "text": "x" }], "stop_reason": reason,
                    "usage": { "input_tokens": 0, "output_tokens": 0 } })
        };
        assert_eq!(
            p.from_anthropic_response(&mk("end_turn"), "m")["choices"][0]["finish_reason"],
            json!("stop")
        );
        assert_eq!(
            p.from_anthropic_response(&mk("tool_use"), "m")["choices"][0]["finish_reason"],
            json!("tool_calls")
        );
        // Unknown / missing stop_reason defaults to "stop".
        assert_eq!(
            p.from_anthropic_response(&mk("weird"), "m")["choices"][0]["finish_reason"],
            json!("stop")
        );
    }

    #[test]
    fn from_anthropic_response_handles_missing_fields() {
        let p = dummy();
        // Empty response: content missing, usage missing, id missing.
        let out = p.from_anthropic_response(&json!({}), "m");
        assert_eq!(out["id"], json!("msg_unknown"));
        assert_eq!(out["choices"][0]["message"]["content"], json!(""));
        assert_eq!(out["usage"]["total_tokens"], json!(0));
    }

    // ── prompt caching: system blocks, usage, TTL beta ───────────────────────

    #[test]
    fn to_anthropic_body_keeps_array_system_and_its_cache_breakpoint() {
        let p = dummy();
        // Before the fix this dropped the system prompt entirely: the old
        // `filter_map(as_str)` skipped every array-form system message.
        let body = json!({
            "messages": [
                { "role": "system", "content": [
                    { "type": "text", "text": "HUGE PREFIX",
                      "cache_control": { "type": "ephemeral" } }
                ]},
                { "role": "user", "content": "hi" }
            ]
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(out["system"][0]["text"], json!("HUGE PREFIX"));
        assert_eq!(out["system"][0]["cache_control"]["type"], json!("ephemeral"));
    }

    #[test]
    fn to_anthropic_body_joins_plain_array_system_into_a_string() {
        let p = dummy();
        // No cache_control anywhere ⇒ the historical string shape is preserved,
        // so a non-caching caller's wire format is byte-identical to before.
        let body = json!({
            "messages": [
                { "role": "system", "content": [{ "type": "text", "text": "one" }] },
                { "role": "system", "content": "two" }
            ]
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(out["system"], json!("one\n\ntwo"));
    }

    #[test]
    fn to_anthropic_body_passes_message_cache_control_through() {
        let p = dummy();
        let body = json!({
            "messages": [{ "role": "user", "content": [
                { "type": "text", "text": "ctx", "cache_control": { "type": "ephemeral" } }
            ]}]
        });
        let out = p.to_anthropic_body("m", &body);
        assert_eq!(
            out["messages"][0]["content"][0]["cache_control"]["type"],
            json!("ephemeral")
        );
    }

    #[test]
    fn from_anthropic_response_surfaces_cache_read_and_write_tokens() {
        let p = dummy();
        let resp = json!({
            "content": [{ "type": "text", "text": "x" }],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "cache_read_input_tokens": 900,
                "cache_creation_input_tokens": 100
            }
        });
        let out = p.from_anthropic_response(&resp, "m");
        // OpenAI-shape prompt_tokens includes the cache legs Anthropic excludes.
        assert_eq!(out["usage"]["prompt_tokens"], json!(1010));
        assert_eq!(out["usage"]["total_tokens"], json!(1015));
        assert_eq!(
            out["usage"]["prompt_tokens_details"]["cached_tokens"],
            json!(900)
        );
        assert_eq!(
            out["usage"]["prompt_tokens_details"]["cache_write_tokens"],
            json!(100)
        );
        // Native names survive too.
        assert_eq!(out["usage"]["cache_read_input_tokens"], json!(900));
        assert_eq!(out["usage"]["cache_creation_input_tokens"], json!(100));
    }

    #[test]
    fn from_anthropic_response_omits_cache_details_when_uncached() {
        let p = dummy();
        let resp = json!({
            "content": [{ "text": "x" }],
            "usage": { "input_tokens": 4, "output_tokens": 2 }
        });
        let out = p.from_anthropic_response(&resp, "m");
        assert_eq!(out["usage"]["prompt_tokens"], json!(4));
        assert!(out["usage"].get("prompt_tokens_details").is_none());
    }

    #[test]
    fn wants_extended_cache_ttl_only_for_non_default_ttl() {
        assert!(!wants_extended_cache_ttl(&json!({
            "system": [{ "cache_control": { "type": "ephemeral" } }]
        })));
        assert!(!wants_extended_cache_ttl(&json!({
            "system": [{ "cache_control": { "type": "ephemeral", "ttl": "5m" } }]
        })));
        assert!(wants_extended_cache_ttl(&json!({
            "messages": [{ "content": [{ "cache_control": { "ttl": "1h" } }] }]
        })));
    }

    #[tokio::test]
    async fn complete_sends_ttl_beta_header_only_when_asked() {
        let ok = r#"{"id":"m","content":[{"text":"ok"}],"stop_reason":"end_turn",
                    "usage":{"input_tokens":1,"output_tokens":1}}"#;

        let plain = MockServer::always(MockResponse::ok_json(ok)).await;
        let p = provider_with(plain.base_url().to_string(), vec!["k"]);
        p.complete("m", &json!({ "messages": [{ "role": "user", "content": "hi" }] }))
            .await
            .unwrap();
        assert!(plain.requests()[0].header("anthropic-beta").is_none());

        let ttl = MockServer::always(MockResponse::ok_json(ok)).await;
        let p = provider_with(ttl.base_url().to_string(), vec!["k"]);
        p.complete(
            "m",
            &json!({ "messages": [{ "role": "system", "content": [
                { "type": "text", "text": "big",
                  "cache_control": { "type": "ephemeral", "ttl": "1h" } }
            ]}]}),
        )
        .await
        .unwrap();
        assert_eq!(
            ttl.requests()[0].header("anthropic-beta").as_deref(),
            Some(EXTENDED_CACHE_TTL_BETA)
        );
    }

    #[tokio::test]
    async fn translate_anthropic_stream_emits_usage_with_cache_counts_once() {
        let sse = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":900,\"cache_creation_input_tokens\":0}}}\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":7}}\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n",
        );
        let out = collect_stream(vec![sse], "m").await;
        assert!(out.contains(r#""prompt_tokens":910"#), "got: {out}");
        assert!(out.contains(r#""completion_tokens":7"#), "got: {out}");
        assert!(out.contains(r#""cached_tokens":900"#), "got: {out}");
        // message_delta + message_stop must not both terminate the stream.
        assert_eq!(out.matches("data: [DONE]").count(), 1, "got: {out}");
    }

    #[test]
    fn next_key_rotates_round_robin() {
        let p = provider_with("http://x".into(), vec!["a", "b", "c"]);
        // Round-robin across the three keys, then wraps.
        let seq: Vec<String> = (0..4).map(|_| p.next_key()).collect();
        assert_eq!(seq, vec!["a", "b", "c", "a"]);
    }

    #[test]
    fn next_key_single_key_is_stable() {
        let p = provider_with("http://x".into(), vec!["only"]);
        assert_eq!(p.next_key(), "only");
        assert_eq!(p.next_key(), "only");
    }

    async fn collect_stream(
        chunks: Vec<&'static str>,
        model: &str,
    ) -> String {
        let raw = futures_util::stream::iter(
            chunks
                .into_iter()
                .map(|c| Ok::<Bytes, reqwest::Error>(Bytes::from(c)))
                .collect::<Vec<_>>(),
        );
        let translated = translate_anthropic_stream(raw, model.to_string());
        let mut out = String::new();
        futures_util::pin_mut!(translated);
        while let Some(item) = translated.next().await {
            out.push_str(std::str::from_utf8(&item.unwrap()).unwrap());
        }
        out
    }

    #[tokio::test]
    async fn translate_anthropic_stream_emits_openai_deltas_and_done() {
        let sse = concat!(
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n",
        );
        let out = collect_stream(vec![sse], "my-model").await;
        assert!(out.contains(r#""content":"Hel""#), "got: {out}");
        assert!(out.contains(r#""content":"lo""#), "got: {out}");
        assert!(out.contains(r#""object":"chat.completion.chunk""#));
        assert!(out.contains(r#""model":"my-model""#));
        assert!(out.contains(r#""finish_reason":"stop""#));
        assert!(out.contains("data: [DONE]"));
    }

    #[tokio::test]
    async fn translate_anthropic_stream_ignores_unknown_events() {
        let sse = concat!(
            "event: ping\n",
            "data: {\"type\":\"ping\"}\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\"}\n",
        );
        let out = collect_stream(vec![sse], "m").await;
        // No text deltas, no stop → no OpenAI chunks emitted.
        assert!(out.is_empty(), "expected empty, got: {out}");
    }

    #[tokio::test]
    async fn complete_translates_and_sends_anthropic_headers() {
        let server = MockServer::always(MockResponse::ok_json(
            r#"{"id":"msg_1","content":[{"type":"text","text":"hi there"}],
                "stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":5}}"#,
        ))
        .await;
        let p = provider_with(server.base_url().to_string(), vec!["sk-secret-KEY"]);
        let body = json!({ "model": "claude-alias", "messages": [{ "role": "user", "content": "hi" }] });
        let out = p.complete("claude-3-5", &body).await.unwrap();

        assert_eq!(out["choices"][0]["message"]["content"], json!("hi there"));
        assert_eq!(out["usage"]["total_tokens"], json!(8));
        // Response is shaped with the caller's *requested* model, not the routed one.
        assert_eq!(out["model"], json!("claude-alias"));

        let reqs = server.requests();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].path, "/v1/messages");
        assert_eq!(reqs[0].header("x-api-key").as_deref(), Some("sk-secret-KEY"));
        assert_eq!(
            reqs[0].header("anthropic-version").as_deref(),
            Some("2023-06-01")
        );
        // The routed model (not the alias) is what goes upstream.
        assert_eq!(reqs[0].json()["model"], json!("claude-3-5"));
    }

    #[tokio::test]
    async fn complete_error_does_not_leak_the_api_key() {
        const SECRET: &str = "sk-ant-DO-NOT-LEAK-0xDEADBEEF";
        let server = MockServer::always(MockResponse::json(
            400,
            r#"{"error":{"message":"invalid request"}}"#,
        ))
        .await;
        let p = provider_with(server.base_url().to_string(), vec![SECRET]);
        let body = json!({ "messages": [{ "role": "user", "content": "hi" }] });
        let err = p.complete("m", &body).await.unwrap_err();

        // The key WAS used for auth (constructed correctly)...
        assert_eq!(
            server.requests()[0].header("x-api-key").as_deref(),
            Some(SECRET)
        );
        // ...but it must never appear in the error surfaced to the caller.
        let rendered = format!("{err}{err:?}");
        assert!(!rendered.contains(SECRET), "key leaked in error: {rendered}");
        assert!(rendered.contains("invalid request"));
    }

    #[tokio::test]
    async fn complete_rotates_key_on_429() {
        let server = MockServer::start(vec![
            MockResponse::json(429, "slow down"),
            MockResponse::ok_json(
                r#"{"id":"m","content":[{"text":"ok"}],"stop_reason":"end_turn",
                    "usage":{"input_tokens":1,"output_tokens":1}}"#,
            ),
        ])
        .await;
        let p = provider_with(server.base_url().to_string(), vec!["key-A", "key-B"]);
        let body = json!({ "messages": [{ "role": "user", "content": "hi" }] });
        let out = p.complete("m", &body).await.unwrap();
        assert_eq!(out["choices"][0]["message"]["content"], json!("ok"));

        let reqs = server.requests();
        assert_eq!(reqs.len(), 2, "should have rotated to the second key");
        assert_eq!(reqs[0].header("x-api-key").as_deref(), Some("key-A"));
        assert_eq!(reqs[1].header("x-api-key").as_deref(), Some("key-B"));
    }

    #[tokio::test]
    async fn complete_surfaces_rate_limited_when_all_keys_exhausted() {
        let server = MockServer::always(
            MockResponse::json(429, "nope").with_header("retry-after", "9"),
        )
        .await;
        let p = provider_with(server.base_url().to_string(), vec!["a", "b"]);
        let body = json!({ "messages": [] });
        let err = p.complete("m", &body).await.unwrap_err();
        match err {
            ProviderError::RateLimited {
                provider,
                retry_after,
                ..
            } => {
                assert_eq!(provider, "anthropic");
                assert_eq!(retry_after, Some(9));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
        // Both keys were tried before giving up.
        assert_eq!(server.request_count(), 2);
    }
}
