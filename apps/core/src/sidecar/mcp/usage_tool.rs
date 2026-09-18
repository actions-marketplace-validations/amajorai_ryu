//! Built-in provider-usage tools for agents.
//!
//! The subscription readers in [`ryu_usage`] already own the vendor-specific
//! credential and response handling. This module is the agent-facing projection
//! over that primitive: it reports the active provider/model or an explicitly
//! requested provider/model through the normal Core MCP registry, so the Gateway
//! can apply its usual allowlist, budget, and audit controls.
//!
//! Credentials stay inside Core. Subscription credentials come from the active
//! account in the sealed account store, and BYOK keys are handed to the existing
//! credit reader for one request only. Neither credential is placed in tool
//! arguments, logs, or the returned usage projection.

use anyhow::{Context, Result};
use serde_json::{json, Map, Value};

use super::RegistryTool;

/// Reserved registry server for read-only provider usage.
pub const SERVER_NAME: &str = "usage";

/// Read usage for the provider/model currently selected in Ryu's managed Pi.
pub const CURRENT_TOOL_ID: &str = "usage.current";

/// Read usage for an explicitly selected provider and optional model.
pub const QUERY_TOOL_ID: &str = "usage.query";

const MAX_IDENTIFIER_CHARS: usize = 256;

fn current_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false,
        "description": "No arguments. Reads the provider and model currently selected in Ryu."
    })
}

fn query_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "Ryu provider id (for example claude-pro-max, openai-codex, chatgpt, github-copilot, openrouter, deepseek, or moonshot). ACP ids such as acp:claude are also accepted.",
                "minLength": 1,
                "maxLength": MAX_IDENTIFIER_CHARS
            },
            "model": {
                "type": "string",
                "description": "Optional model id. Account-wide windows are always returned; model-scoped windows are included when they match this model.",
                "minLength": 1,
                "maxLength": MAX_IDENTIFIER_CHARS
            }
        },
        "required": ["provider"],
        "additionalProperties": false
    })
}

fn read_only_annotations() -> Value {
    json!({
        "readOnlyHint": true,
        "destructiveHint": false
    })
}

/// The read-only usage tools exposed through the unified catalog.
pub fn tools() -> Vec<RegistryTool> {
    let annotations = read_only_annotations();
    vec![
        RegistryTool {
            id: CURRENT_TOOL_ID.to_owned(),
            server: SERVER_NAME.to_owned(),
            name: "current".to_owned(),
            description: Some(
                "Read the currently active Ryu provider and model's live usage. Returns remaining percent, used percent, window length, and the exact reset time for 5-hour, weekly, or other provider-reported limits; unavailable providers return a structured reason instead of fabricated zeros.".to_owned(),
            ),
            input_schema: Some(current_schema()),
            annotations: Some(annotations.clone()),
            ..Default::default()
        },
        RegistryTool {
            id: QUERY_TOOL_ID.to_owned(),
            server: SERVER_NAME.to_owned(),
            name: "query".to_owned(),
            description: Some(
                "Read live usage for a specified provider and optional model. Returns account-wide and matching model-scoped windows with remaining percent, used percent, window length, and reset timestamps, plus provider credit meters when that provider exposes a balance endpoint.".to_owned(),
            ),
            input_schema: Some(query_schema()),
            annotations: Some(annotations),
            ..Default::default()
        },
    ]
}

/// Dispatch a `usage` tool call. Vendor failures remain structured usage
/// results; malformed tool arguments and unknown tool ids are real errors.
pub async fn dispatch(tool: &str, arguments: Value) -> Result<Value> {
    match tool {
        "current" => dispatch_current(arguments).await,
        "query" => dispatch_query(arguments).await,
        other => Err(anyhow::anyhow!("unknown usage tool '{other}'")),
    }
}

async fn dispatch_current(arguments: Value) -> Result<Value> {
    let object = object_arguments(&arguments)?;
    reject_unknown_keys(object, &[])?;

    let active = crate::pi_config::current();
    let provider = bounded_identifier(&active.provider, "active provider")?;
    let model = active
        .model
        .as_deref()
        .map(|value| bounded_identifier(value, "active model"))
        .transpose()?;
    query_usage(&provider, model.as_deref(), &active, true).await
}

async fn dispatch_query(arguments: Value) -> Result<Value> {
    let object = object_arguments(&arguments)?;
    reject_unknown_keys(object, &["provider", "model"])?;
    let provider = required_identifier(object, "provider")?;
    let model = optional_identifier(object, "model")?;
    let active = crate::pi_config::current();
    query_usage(&provider, model.as_deref(), &active, false).await
}

fn object_arguments(arguments: &Value) -> Result<&Map<String, Value>> {
    arguments
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("usage tool arguments must be a JSON object"))
}

fn reject_unknown_keys(object: &Map<String, Value>, allowed: &[&str]) -> Result<()> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(anyhow::anyhow!("unknown usage tool argument '{key}'"));
    }
    Ok(())
}

fn required_identifier(object: &Map<String, Value>, key: &str) -> Result<String> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("usage.query requires a string '{key}'"))?;
    bounded_identifier(value, key)
}

fn optional_identifier(object: &Map<String, Value>, key: &str) -> Result<Option<String>> {
    match object.get(key) {
        None => Ok(None),
        Some(value) => value
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("usage.query '{key}' must be a string"))
            .and_then(|value| bounded_identifier(value, key))
            .map(Some),
    }
}

fn bounded_identifier(value: &str, label: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(anyhow::anyhow!("usage tool requires a non-empty {label}"));
    }
    if value.chars().count() > MAX_IDENTIFIER_CHARS {
        return Err(anyhow::anyhow!(
            "usage tool {label} exceeds {MAX_IDENTIFIER_CHARS} characters"
        ));
    }
    Ok(value.to_owned())
}

async fn query_usage(
    provider: &str,
    model: Option<&str>,
    active: &crate::pi_config::PiConfigView,
    is_current: bool,
) -> Result<Value> {
    let (snapshot, source) = fetch_provider_snapshot(provider).await?;
    let usage = project_snapshot(provider, &snapshot, model);
    Ok(json!({
        "ok": true,
        "current": is_current,
        "active": {
            "provider": active.provider.clone(),
            "model": active.model.clone(),
            "routing": active.routing.clone(),
        },
        "requested": {
            "provider": provider,
            "model": model,
        },
        "source": source,
        "usage": usage,
    }))
}

/// Select the credential source without letting a model choose a secret.
///
/// ACP ids read the CLI credential that belongs to that agent. Ryu-managed
/// subscription provider ids use the active account from Core's sealed vault.
/// Providers with a supported prepaid-balance endpoint use the existing BYOK
/// key resolver. Everything else still returns the normalized unsupported result
/// from `ryu_usage`.
async fn fetch_provider_snapshot(provider: &str) -> Result<(Value, &'static str)> {
    if provider.trim().to_ascii_lowercase().starts_with("acp:") {
        let snapshot = ryu_usage::fetch_usage(provider).await;
        let source = if snapshot.engine.is_empty() {
            "unavailable"
        } else {
            "subscription"
        };
        return serialized_snapshot(snapshot, source);
    }

    if ryu_usage::supports_provider_credits(provider) {
        let key = crate::pi_config::provider_api_key(provider).unwrap_or_default();
        let snapshot = ryu_usage::fetch_provider_credits(provider, &key).await;
        return serialized_snapshot(snapshot, "api_credits");
    }

    if crate::pi_config::oauth_login::oauth_provider_id(provider).is_some() {
        // A vault read failure is represented by the same structured
        // `not_logged_in` snapshot as the existing HTTP usage route. It never
        // falls back to returning the credential or an internal vault error.
        let credential = crate::pi_config::subscription_active_credential(provider).unwrap_or(None);
        let snapshot =
            ryu_usage::fetch_ryu_provider_usage_for_credential(provider, credential).await;
        return serialized_snapshot(snapshot, "subscription");
    }

    let snapshot = ryu_usage::fetch_ryu_provider_usage(provider).await;
    let source = if snapshot.engine.is_empty() {
        "unavailable"
    } else {
        "subscription"
    };
    serialized_snapshot(snapshot, source)
}

fn serialized_snapshot<T: serde::Serialize>(
    snapshot: T,
    source: &'static str,
) -> Result<(Value, &'static str)> {
    serde_json::to_value(snapshot)
        .context("could not serialize provider usage snapshot")
        .map(|value| (value, source))
}

fn project_snapshot(provider: &str, snapshot: &Value, model: Option<&str>) -> Value {
    let (windows, model_matched) = project_windows(snapshot, model);
    json!({
        "providerId": provider,
        "agentId": snapshot.get("agent_id").cloned().unwrap_or(Value::Null),
        "engine": snapshot.get("engine").cloned().unwrap_or(Value::Null),
        "available": snapshot.get("available").and_then(Value::as_bool).unwrap_or(false),
        "plan": snapshot.get("plan").cloned().unwrap_or(Value::Null),
        "reason": snapshot.get("reason").cloned().unwrap_or(Value::Null),
        "modelMatched": model_matched,
        "windows": windows,
        "meters": project_meters(snapshot.get("meters")),
        "extraUsageUsd": snapshot.get("extra_usage_usd").cloned().unwrap_or(Value::Null),
        "retryAfterSeconds": snapshot.get("retry_after_seconds").cloned().unwrap_or(Value::Null),
    })
}

fn project_windows(snapshot: &Value, model: Option<&str>) -> (Vec<Value>, Option<bool>) {
    let rows = snapshot
        .get("windows")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let model_matched = model.map(|requested| {
        rows.iter().any(|row| {
            row.get("model")
                .and_then(Value::as_str)
                .is_some_and(|candidate| models_match(candidate, requested))
        })
    });

    let projected = rows
        .iter()
        .filter(|row| {
            let Some(requested) = model else {
                return true;
            };
            row.get("model")
                .and_then(Value::as_str)
                .is_none_or(|candidate| models_match(candidate, requested))
        })
        .filter_map(project_window)
        .collect();
    (projected, model_matched)
}

fn project_window(row: &Value) -> Option<Value> {
    let used = row
        .get("used_percent")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())?
        .clamp(0.0, 100.0);
    let label = row
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let model = row
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let window_seconds = row.get("window_seconds").and_then(Value::as_i64);
    let resets_at = row
        .get("resets_at")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Some(json!({
        "label": label,
        "window": short_window_label(window_seconds, label),
        "windowSeconds": window_seconds,
        "scope": if model.is_some() { "model" } else { "account" },
        "model": model,
        "usedPercent": used,
        "remainingPercent": (100.0 - used).clamp(0.0, 100.0),
        "resetsAt": resets_at,
    }))
}

fn project_meters(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|meters| {
            meters
                .iter()
                .filter_map(|meter| {
                    let values = meter
                        .get("values")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(|value| {
                                    let number = value
                                        .get("number")
                                        .and_then(Value::as_f64)
                                        .filter(|number| number.is_finite())?;
                                    Some(json!({
                                        "number": number,
                                        "kind": value.get("kind").cloned().unwrap_or(Value::Null),
                                        "unit": value.get("unit").cloned().unwrap_or(Value::Null),
                                    }))
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let label = meter
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    Some(json!({
                        "label": label,
                        "values": values,
                        "expiresAt": meter.get("expires_at").cloned().unwrap_or_else(|| json!([])),
                        "resetsAt": meter.get("resets_at").cloned().unwrap_or(Value::Null),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn short_window_label(seconds: Option<i64>, fallback: &str) -> String {
    let Some(seconds) = seconds.filter(|seconds| *seconds > 0) else {
        return fallback.to_owned();
    };
    const HOUR: i64 = 60 * 60;
    const DAY: i64 = 24 * HOUR;
    if seconds % DAY == 0 {
        return format!("{}d", seconds / DAY);
    }
    if seconds % HOUR == 0 {
        return format!("{}h", seconds / HOUR);
    }
    if seconds % 60 == 0 {
        return format!("{}m", seconds / 60);
    }
    format!("{seconds}s")
}

fn models_match(candidate: &str, requested: &str) -> bool {
    let candidate = normalized_model(candidate);
    let requested = normalized_model(requested);
    !candidate.is_empty()
        && !requested.is_empty()
        && (candidate == requested
            || candidate.contains(&requested)
            || requested.contains(&candidate))
}

fn normalized_model(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_current_and_query_tools_with_read_only_annotations() {
        let tools = tools();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].id, CURRENT_TOOL_ID);
        assert_eq!(tools[1].id, QUERY_TOOL_ID);
        assert_eq!(tools[0].annotations, Some(read_only_annotations()));
        assert_eq!(
            tools[1]
                .input_schema
                .as_ref()
                .and_then(|schema| schema.get("required").and_then(Value::as_array).cloned()),
            Some(vec![json!("provider")])
        );
    }

    #[test]
    fn projects_remaining_percent_and_reset_time_for_account_and_model_windows() {
        let raw = json!({
            "agent_id": "acp:claude",
            "engine": "claude",
            "available": true,
            "plan": "Max 20x",
            "windows": [
                {
                    "label": "Session",
                    "used_percent": 42.5,
                    "window_seconds": 18_000,
                    "resets_at": "2026-09-17T05:00:00Z",
                    "model": null
                },
                {
                    "label": "Sonnet",
                    "used_percent": 80.0,
                    "window_seconds": 604_800,
                    "resets_at": "2026-09-20T05:00:00Z",
                    "model": "Sonnet"
                },
                {
                    "label": "Opus",
                    "used_percent": 90.0,
                    "window_seconds": 604_800,
                    "resets_at": "2026-09-20T05:00:00Z",
                    "model": "Opus"
                }
            ]
        });
        let projected = project_snapshot("claude-pro-max", &raw, Some("claude-sonnet-4"));
        assert_eq!(projected["available"], true);
        assert_eq!(projected["modelMatched"], true);
        assert_eq!(projected["windows"].as_array().unwrap().len(), 2);
        assert_eq!(projected["windows"][0]["window"], "5h");
        assert_eq!(projected["windows"][0]["remainingPercent"], 57.5);
        assert_eq!(projected["windows"][0]["scope"], "account");
        assert_eq!(projected["windows"][0]["resetsAt"], "2026-09-17T05:00:00Z");
        assert_eq!(projected["windows"][1]["window"], "7d");
        assert_eq!(projected["windows"][1]["remainingPercent"], 20.0);
        assert_eq!(projected["windows"][1]["model"], "Sonnet");
    }

    #[test]
    fn model_query_does_not_return_an_unrelated_model_window() {
        let raw = json!({
            "available": true,
            "windows": [
                { "label": "Weekly", "used_percent": 10.0, "model": null },
                { "label": "Opus", "used_percent": 80.0, "model": "Opus" }
            ]
        });
        let projected = project_snapshot("claude-pro-max", &raw, Some("sonnet"));
        assert_eq!(projected["modelMatched"], false);
        assert_eq!(projected["windows"].as_array().unwrap().len(), 1);
        assert_eq!(projected["windows"][0]["scope"], "account");
    }

    #[test]
    fn projects_prepaid_meter_values_and_their_reset_metadata() {
        let raw = json!({
            "available": true,
            "meters": [{
                "label": "API credit",
                "values": [{ "number": 12.34, "kind": "dollars", "unit": null }],
                "expires_at": [],
                "resets_at": "2026-10-01T00:00:00Z"
            }]
        });
        let projected = project_snapshot("openrouter", &raw, None);
        assert_eq!(projected["meters"][0]["label"], "API credit");
        assert_eq!(projected["meters"][0]["values"][0]["number"], 12.34);
        assert_eq!(projected["meters"][0]["values"][0]["kind"], "dollars");
        assert_eq!(projected["meters"][0]["resetsAt"], "2026-10-01T00:00:00Z");
    }

    #[test]
    fn model_matching_accepts_provider_model_ids_and_display_names() {
        assert!(models_match("GPT-5.3-Codex-Spark", "gpt-5.3-codex-spark"));
        assert!(models_match("Sonnet", "claude-sonnet-4"));
        assert!(!models_match("Opus", "claude-sonnet-4"));
    }

    #[tokio::test]
    async fn query_rejects_bad_arguments_before_reading_provider_state() {
        assert!(dispatch("query", json!({})).await.is_err());
        assert!(dispatch("query", json!({ "provider": " " })).await.is_err());
        assert!(dispatch("query", json!({ "provider": "x", "extra": true }))
            .await
            .is_err());
        assert!(dispatch("current", json!({ "provider": "x" }))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn unknown_provider_returns_structured_unavailable_usage() {
        let result = dispatch(
            "query",
            json!({ "provider": "definitely-not-a-provider", "model": "anything" }),
        )
        .await
        .expect("unknown providers are a structured usage result");
        assert_eq!(result["ok"], true);
        assert_eq!(result["usage"]["available"], false);
        assert_eq!(result["usage"]["reason"], "unsupported");
        assert_eq!(result["usage"]["windows"], json!([]));
        assert_eq!(result["requested"]["model"], "anything");
    }
}
