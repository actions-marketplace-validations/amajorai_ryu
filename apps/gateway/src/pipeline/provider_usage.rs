//! Provider usage parsing; policy and accounting side effects stay in the pipeline.

use serde_json::{json, Value};

/// Inject `stream_options.include_usage = true` into the request body so
/// OpenAI-compatible providers emit a terminal usage frame at the end of the
/// SSE stream. Non-conforming providers silently ignore the field and the
/// stream observer falls back to the prompt-token estimate.
///
/// This is driven by `evals.stream_usage` in the config, never hardcoded.
pub(super) fn inject_stream_usage_option(body: &mut Value) {
    if let Some(obj) = body.as_object_mut() {
        let opts = obj.entry("stream_options").or_insert_with(|| json!({}));
        if let Some(opts_obj) = opts.as_object_mut() {
            opts_obj.entry("include_usage").or_insert(json!(true));
        }
    }
}

/// Parse streamed token counts from an assembled OpenAI SSE transcript.
///
/// OpenAI-compatible providers emit one terminal "usage" chunk when
/// `stream_options.include_usage = true`. Its shape is:
/// ```json
/// {"choices":[],"usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":T}}
/// ```
/// We scan all `data:` frames for a non-empty `usage` block (any frame may
/// carry it; in practice it is the last non-DONE frame). Returns `(0, 0)` when
/// no usage frame is found, falling back to the caller's estimate.
pub(super) fn sse_parse_usage(raw: &str) -> (u64, u64) {
    let mut best = (0u64, 0u64);
    for line in raw.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let input = json["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
        let output = json["usage"]["completion_tokens"].as_u64().unwrap_or(0);
        if input > 0 || output > 0 {
            best = (input, output);
        }
    }
    best
}

/// Read the provider-side prompt-cache read count from a chat-completions
/// response `usage` block. Covers OpenRouter/OpenAI
/// (`prompt_tokens_details.cached_tokens`) and Anthropic-shaped
/// (`cache_read_input_tokens`) usage. Returns 0 when the provider reports no
/// prompt caching (the common case, so this stays a cheap no-op).
pub(super) fn provider_cached_tokens(response: &Value) -> u64 {
    let usage = &response["usage"];
    usage["prompt_tokens_details"]["cached_tokens"]
        .as_u64()
        .or_else(|| usage["cache_read_input_tokens"].as_u64())
        .unwrap_or(0)
}

/// Counterpart of [`provider_cached_tokens`] for cache *writes* — prompt tokens
/// the provider stored rather than served. Tracked separately because a write is
/// billed above the normal input rate, so "cached_tokens went up" alone cannot
/// tell an operator whether caching is saving money or costing it.
pub(super) fn provider_cache_write_tokens(response: &Value) -> u64 {
    let usage = &response["usage"];
    usage["prompt_tokens_details"]["cache_write_tokens"]
        .as_u64()
        .or_else(|| usage["cache_creation_input_tokens"].as_u64())
        .unwrap_or(0)
}

/// Streaming counterpart of [`provider_cache_write_tokens`].
pub(super) fn sse_parse_cache_write_tokens(raw: &str) -> u64 {
    sse_scan_usage(raw, provider_cache_write_tokens)
}

/// Scan an assembled SSE transcript, applying `pick` to every parseable frame
/// and keeping the last non-zero result — the terminal usage frame in practice.
fn sse_scan_usage(raw: &str, pick: fn(&Value) -> u64) -> u64 {
    let mut best = 0u64;
    for line in raw.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let n = pick(&json);
        if n > 0 {
            best = n;
        }
    }
    best
}

/// Streaming counterpart of [`provider_cached_tokens`]: scan an assembled SSE
/// transcript for the terminal usage frame's cached-token count. Mirrors
/// [`sse_parse_usage`]; returns 0 when absent.
pub(super) fn sse_parse_cached_tokens(raw: &str) -> u64 {
    let mut best = 0u64;
    for line in raw.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let cached = provider_cached_tokens(&json);
        if cached > 0 {
            best = cached;
        }
    }
    best
}

/// Read a provider-reported USD cost from either the normal response envelope
/// or a preserved raw payload (OpenRouter image output uses `raw`).
pub(super) fn response_reported_cost_usd(response: &Value) -> Option<f64> {
    response
        .get("usage")
        .and_then(|usage| usage.get("cost"))
        .or_else(|| {
            response
                .get("raw")
                .and_then(|raw| raw.get("usage"))
                .and_then(|usage| usage.get("cost"))
        })
        .and_then(Value::as_f64)
        .filter(|cost| cost.is_finite() && *cost >= 0.0)
}

/// Convert a provider-reported USD cost to micro-USD. Zero is meaningful: a
/// provider promotion can make a managed request free, so only negative and
/// non-finite values fall back to the token estimate.
pub(super) fn cost_usd_to_micro(cost_usd: f64) -> Option<u64> {
    if cost_usd.is_finite() && cost_usd >= 0.0 {
        Some((cost_usd * 1_000_000.0).round() as u64)
    } else {
        None
    }
}

/// Extract the provider-reported generation cost (USD) from an assembled SSE
/// transcript. OpenRouter includes `usage.cost` in the terminal usage frame when
/// usage accounting is enabled; mirrors [`sse_parse_usage`]. `None` when absent.
pub(super) fn sse_parse_cost(raw: &str) -> Option<f64> {
    let mut best = None;
    for line in raw.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if let Some(cost) = json["usage"]["cost"].as_f64() {
            if cost.is_finite() && cost >= 0.0 {
                best = Some(cost);
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_usage_is_read_from_both_provider_vocabularies() {
        // OpenAI / OpenRouter shape.
        let oai = json!({ "usage": { "prompt_tokens_details": {
            "cached_tokens": 900, "cache_write_tokens": 100 } } });
        assert_eq!(provider_cached_tokens(&oai), 900);
        assert_eq!(provider_cache_write_tokens(&oai), 100);

        // Anthropic-native shape.
        let ant = json!({ "usage": {
            "cache_read_input_tokens": 42, "cache_creation_input_tokens": 7 } });
        assert_eq!(provider_cached_tokens(&ant), 42);
        assert_eq!(provider_cache_write_tokens(&ant), 7);

        // Uncached responses stay at zero (no phantom counters).
        let plain = json!({ "usage": { "prompt_tokens": 10 } });
        assert_eq!(provider_cached_tokens(&plain), 0);
        assert_eq!(provider_cache_write_tokens(&plain), 0);
    }

    #[test]
    fn stream_cache_usage_is_read_from_the_terminal_frame() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
            "data: {\"usage\":{\"prompt_tokens\":1000,\"prompt_tokens_details\":",
            "{\"cached_tokens\":900,\"cache_write_tokens\":100}}}\n\n",
            "data: [DONE]\n\n",
        );
        assert_eq!(sse_parse_cached_tokens(sse), 900);
        assert_eq!(sse_parse_cache_write_tokens(sse), 100);
    }

    /// inject_stream_usage_option adds include_usage=true to the body.
    /// A second call must not overwrite an existing value (idempotent).
    #[test]
    fn inject_stream_usage_option_adds_field_and_is_idempotent() {
        let mut body = json!({ "model": "gpt-4o", "messages": [] });
        inject_stream_usage_option(&mut body);
        assert_eq!(body["stream_options"]["include_usage"], json!(true));

        // Calling again must not change anything.
        inject_stream_usage_option(&mut body);
        assert_eq!(body["stream_options"]["include_usage"], json!(true));
    }

    /// inject_stream_usage_option preserves existing stream_options fields.
    #[test]
    fn inject_stream_usage_option_preserves_existing_stream_options() {
        let mut body = json!({
            "model": "gpt-4o",
            "stream_options": { "custom_field": 42 }
        });
        inject_stream_usage_option(&mut body);
        assert_eq!(body["stream_options"]["include_usage"], json!(true));
        // Original field must survive.
        assert_eq!(body["stream_options"]["custom_field"], json!(42));
    }

    /// sse_parse_usage extracts prompt_tokens and completion_tokens from the
    /// terminal OpenAI usage frame. This is the recorded SSE fixture for AC2.
    #[test]
    fn sse_parse_usage_extracts_from_terminal_usage_frame() {
        // Recorded SSE fixture: two content delta chunks + terminal usage chunk
        // + DONE, as emitted by OpenAI when stream_options.include_usage=true.
        let raw = concat!(
            "data: {\"id\":\"chatcmpl-x\",\"object\":\"chat.completion.chunk\",",
            "\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"chatcmpl-x\",\"object\":\"chat.completion.chunk\",",
            "\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":\"stop\"}]}\n\n",
            // Terminal usage frame: choices is empty, usage carries the real counts.
            "data: {\"id\":\"chatcmpl-x\",\"object\":\"chat.completion.chunk\",",
            "\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":8,\"total_tokens\":20}}\n\n",
            "data: [DONE]\n\n"
        );

        let (input, output) = sse_parse_usage(raw);
        assert_eq!(
            input, 12,
            "prompt_tokens must be parsed from the terminal usage frame"
        );
        assert_eq!(
            output, 8,
            "completion_tokens must be parsed from the terminal usage frame"
        );
    }

    /// sse_parse_usage returns (0, 0) when the provider emits no usage frame,
    /// so the caller can fall back to the prompt estimate.
    #[test]
    fn sse_parse_usage_returns_zeros_when_no_usage_frame_present() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (input, output) = sse_parse_usage(raw);
        assert_eq!(input, 0);
        assert_eq!(output, 0);
    }

    /// sse_parse_usage ignores malformed lines and picks the last usage frame.
    #[test]
    fn sse_parse_usage_handles_malformed_lines_and_multiple_usage_frames() {
        let raw = concat!(
            ": keep-alive\n\n",
            "data: not-json\n\n",
            // First usage frame with lower counts.
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\n",
            // Second usage frame wins (last non-zero wins).
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":10}}\n\n",
            "data: [DONE]\n\n"
        );
        let (input, output) = sse_parse_usage(raw);
        // Last non-zero frame wins.
        assert_eq!(input, 20);
        assert_eq!(output, 10);
    }

    /// sse_parse_cost pulls OpenRouter's `usage.cost` from the terminal frame.
    #[test]
    fn sse_parse_cost_extracts_reported_cost() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":8,",
            "\"cost\":0.0023}}\n\n",
            "data: [DONE]\n\n"
        );
        assert_eq!(sse_parse_cost(raw), Some(0.0023));
    }

    /// No `usage.cost` (non-OpenRouter provider) → None, so the debit falls back
    /// to the flat token estimate.
    #[test]
    fn sse_parse_cost_absent_returns_none() {
        let raw = concat!(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\n",
            "data: [DONE]\n\n"
        );
        assert_eq!(sse_parse_cost(raw), None);
    }

    /// cost_usd_to_micro converts dollars to micro-USD and rejects junk values.
    #[test]
    fn cost_usd_to_micro_converts_and_rejects_negative_or_nonfinite() {
        assert_eq!(cost_usd_to_micro(0.0023), Some(2300));
        assert_eq!(cost_usd_to_micro(1.0), Some(1_000_000));
        assert_eq!(cost_usd_to_micro(0.0), Some(0));
        assert_eq!(cost_usd_to_micro(-1.0), None);
        assert_eq!(cost_usd_to_micro(f64::NAN), None);
        assert_eq!(cost_usd_to_micro(f64::INFINITY), None);
    }

    #[test]
    fn sse_parse_cost_preserves_a_free_provider_transaction() {
        let raw = "data: {\"usage\":{\"cost\":0}}\n\n";
        assert_eq!(sse_parse_cost(raw), Some(0.0));
        assert_eq!(cost_usd_to_micro(sse_parse_cost(raw).unwrap()), Some(0));
    }
}
