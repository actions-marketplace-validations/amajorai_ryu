//! Google Gemini (`generateContent` / `streamGenerateContent`) ↔ unified
//! OpenAI shape translation.
//!
//! A Gemini client (Vertex SDKs, `google-genai`, the Gemini CLI) points
//! `base_url` at this gateway and sends `contents: [{role, parts}]`. These
//! functions normalize that request onto the pipeline's OpenAI shape and
//! project the OpenAI response back to Gemini's `candidates`/`parts` form.
//!
//! Role mapping: Gemini uses `user` / `model` (assistant); we map `model` →
//! `assistant` inbound and `assistant` → `model` outbound. `systemInstruction`
//! hoists to an OpenAI `system` message. `generationConfig` fields map to their
//! OpenAI equivalents.

use serde_json::{json, Value};

/// Normalize a Gemini `generateContent` request body into the unified OpenAI
/// chat shape the pipeline consumes.
pub fn request_to_openai(body: &Value) -> Value {
    let mut out = Value::Object(serde_json::Map::new());

    // The model lives on the URL (`models/{model}:generateContent`) for the
    // Gemini protocol. A handler extracts it and injects it here. Allow a body
    // override for convenience.
    if let Some(model) = body.get("model") {
        out["model"] = model.clone();
    }

    let mut messages = contents_to_openai(body);
    // systemInstruction → leading system message.
    if let Some(text) = system_instruction_text(body) {
        messages.insert(0, json!({ "role": "system", "content": text }));
    }
    out["messages"] = Value::Array(messages);

    // generationConfig → OpenAI generation params.
    if let Some(cfg) = body.get("generationConfig") {
        copy_if_present(cfg, &mut out, "temperature", "temperature");
        copy_if_present(cfg, &mut out, "topP", "top_p");
        copy_if_present(cfg, &mut out, "maxOutputTokens", "max_tokens");
        if let Some(stop) = cfg.get("stopSequences") {
            out["stop"] = stop.clone();
        }
    }

    // Gemini tools: `[{functionDeclarations: [{name, description, parameters}]}]`
    // → OpenAI `[{type: "function", function: {...}}]`.
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let mut mapped: Vec<Value> = Vec::new();
        for tool_group in tools {
            if let Some(decls) = tool_group["functionDeclarations"].as_array() {
                for decl in decls {
                    mapped.push(tool_to_openai(decl));
                }
            }
        }
        if !mapped.is_empty() {
            out["tools"] = Value::Array(mapped);
        }
    }

    // Streaming is selected by the URL suffix (`:streamGenerateContent`), not a
    // body field, in the Gemini protocol. The handler sets it.
    copy_if_present(body, &mut out, "stream", "stream");

    out
}

/// Map Gemini `contents: [{role, parts: [{text}]}]` onto OpenAI chat messages.
fn contents_to_openai(body: &Value) -> Vec<Value> {
    let Some(contents) = body.get("contents").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for c in contents {
        let role = match c["role"].as_str() {
            Some("model") => "assistant",
            Some(r) => r,
            None => "user",
        };
        let text = parts_text(&c["parts"]).unwrap_or_default();
        out.push(json!({ "role": role, "content": text }));
    }
    out
}

/// Concatenate the `text` fields of a Gemini `parts` array into one string.
fn parts_text(parts: &Value) -> Option<String> {
    let arr = parts.as_array()?;
    let mut text = String::new();
    for p in arr {
        if let Some(t) = p["text"].as_str() {
            text.push_str(t);
        }
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// The Gemini `systemInstruction` can be `{parts: [...]}` or `{text: "..."}`.
fn system_instruction_text(body: &Value) -> Option<String> {
    let inst = body.get("systemInstruction")?;
    if let Some(parts) = inst.get("parts") {
        return parts_text(parts);
    }
    inst.get("text").and_then(Value::as_str).map(str::to_owned)
}

/// Project a Gemini `{name, description, parameters}` function declaration to
/// OpenAI's `{type: "function", function: {...}}` shape.
fn tool_to_openai(tool: &Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["parameters"],
        }
    })
}

/// Project the pipeline's unified OpenAI chat response to a Gemini
/// `generateContent` response (`candidates` + `usageMetadata`).
pub fn response_to_gemini(response: &Value, requested_model: &str) -> Value {
    let choice = &response["choices"][0];
    let message = &choice["message"];

    let mut parts: Vec<Value> = Vec::new();
    if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
        parts.push(json!({ "text": text }));
    }
    // Tool calls → Gemini `functionCall` parts.
    if let Some(calls) = message["tool_calls"].as_array() {
        for c in calls {
            parts.push(json!({
                "functionCall": {
                    "name": c["function"]["name"],
                    "args": parse_json_arguments(&c["function"]["arguments"]),
                }
            }));
        }
    }

    let usage = &response["usage"];
    let input_tokens = usage["prompt_tokens"].as_u64().unwrap_or(0);
    let output_tokens = usage["completion_tokens"].as_u64().unwrap_or(0);

    json!({
        "candidates": [{
            "content": {
                "role": "model",
                "parts": parts,
            },
            "finishReason": finish_reason_to_gemini(choice["finish_reason"].as_str()),
        }],
        "modelVersion": requested_model,
        "usageMetadata": {
            "promptTokenCount": input_tokens,
            "candidatesTokenCount": output_tokens,
            "totalTokenCount": input_tokens + output_tokens,
        }
    })
}

/// Map an OpenAI finish reason to Gemini's `FINISH_REASON` vocabulary.
pub(crate) fn finish_reason_to_gemini(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_calls") => "STOP", // tools are a normal completion to Gemini
        Some("length") => "MAX_TOKENS",
        Some("content_filter") => "BLOCKLIST",
        Some("stop") | None => "STOP",
        _ => "STOP",
    }
}

/// Decode an OpenAI `function.arguments` JSON-encoded string to the object
/// Gemini wants for `functionCall.args`. Unparseable → `{}`.
pub(crate) fn parse_json_arguments(arguments: &Value) -> Value {
    match arguments {
        Value::String(s) if !s.trim().is_empty() => {
            serde_json::from_str(s).unwrap_or_else(|_| json!({}))
        }
        Value::Object(_) => arguments.clone(),
        _ => json!({}),
    }
}

/// Copy a field when present.
fn copy_if_present(from: &Value, to: &mut Value, from_key: &str, to_key: &str) {
    if let Some(v) = from.get(from_key) {
        to[to_key] = v.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contents_map_roles_and_parts() {
        let body = json!({
            "contents": [
                { "role": "user", "parts": [{ "text": "Hello" }] },
                { "role": "model", "parts": [{ "text": "Hi there" }] },
            ],
        });
        let out = request_to_openai(&body);
        assert_eq!(out["messages"][0]["role"], "user");
        assert_eq!(out["messages"][0]["content"], "Hello");
        assert_eq!(out["messages"][1]["role"], "assistant");
        assert_eq!(out["messages"][1]["content"], "Hi there");
    }

    #[test]
    fn system_instruction_hoists_to_system_message() {
        let body = json!({
            "systemInstruction": { "parts": [{ "text": "Be brief." }] },
            "contents": [{ "role": "user", "parts": [{ "text": "Hi" }] }],
        });
        let out = request_to_openai(&body);
        assert_eq!(out["messages"][0]["role"], "system");
        assert_eq!(out["messages"][0]["content"], "Be brief.");
    }

    #[test]
    fn generation_config_maps_params() {
        let body = json!({
            "generationConfig": {
                "temperature": 0.7,
                "topP": 0.9,
                "maxOutputTokens": 256,
                "stopSequences": ["END"],
            },
            "contents": [{ "role": "user", "parts": [{ "text": "Hi" }] }],
        });
        let out = request_to_openai(&body);
        assert_eq!(out["temperature"], 0.7);
        assert_eq!(out["top_p"], 0.9);
        assert_eq!(out["max_tokens"], 256);
        assert_eq!(out["stop"], json!(["END"]));
    }

    #[test]
    fn tools_flat_map_function_declarations() {
        let body = json!({
            "tools": [{
                "functionDeclarations": [{
                    "name": "get_weather",
                    "description": "Get weather",
                    "parameters": { "type": "object" },
                }],
            }],
            "contents": [{ "role": "user", "parts": [{ "text": "Weather?" }] }],
        });
        let out = request_to_openai(&body);
        assert_eq!(out["tools"][0]["type"], "function");
        assert_eq!(out["tools"][0]["function"]["name"], "get_weather");
    }

    #[test]
    fn response_projects_candidates_and_usage() {
        let oai = json!({
            "choices": [{
                "message": { "role": "assistant", "content": "The answer is 42." },
                "finish_reason": "stop",
            }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5 },
        });
        let out = response_to_gemini(&oai, "gemini-2.0-flash");
        assert_eq!(out["candidates"][0]["content"]["role"], "model");
        assert_eq!(
            out["candidates"][0]["content"]["parts"][0]["text"],
            "The answer is 42."
        );
        assert_eq!(out["candidates"][0]["finishReason"], "STOP");
        assert_eq!(out["usageMetadata"]["promptTokenCount"], 10);
        assert_eq!(out["usageMetadata"]["candidatesTokenCount"], 5);
    }

    #[test]
    fn response_tool_calls_project_to_function_call_parts() {
        let oai = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "function": { "name": "add", "arguments": "{\"a\":1,\"b\":2}" },
                    }],
                },
                "finish_reason": "tool_calls",
            }],
            "usage": { "prompt_tokens": 1, "completion_tokens": 1 },
        });
        let out = response_to_gemini(&oai, "gemini-2.0-flash");
        assert_eq!(
            out["candidates"][0]["content"]["parts"][0]["functionCall"]["name"],
            "add"
        );
        assert_eq!(
            out["candidates"][0]["content"]["parts"][0]["functionCall"]["args"]["a"],
            1
        );
    }
}
