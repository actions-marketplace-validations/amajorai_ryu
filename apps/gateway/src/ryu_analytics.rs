//! Typed Ryu-owned analytics relay for hosted and Core-managed Gateways.
//!
//! This is intentionally not another tracing layer. Customer diagnostics keep
//! using `telemetry.rs` and their own OTLP destination; this module emits only
//! the allowlisted model-call facts the Ryu control plane accepts.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

const ENABLED_ENV: &str = "RYU_ANALYTICS_ENABLED";
const INGEST_URL_ENV: &str = "RYU_ANALYTICS_INGEST_URL";
const INGEST_KEY_ENV: &str = "RYU_ANALYTICS_INGEST_KEY";
const INGEST_SECRET_ENV: &str = "RYU_ANALYTICS_INGEST_SECRET";
const CONTROL_PLANE_URL_ENV: &str = "CONTROL_PLANE_URL";
const CREDITS_SECRET_FALLBACK_ENV: &str = "RYU_CREDITS_INTERNAL_SECRET";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RELAY_PATH: &str = "/api/telemetry/ryu";
const MAX_FIELD_LENGTH: usize = 128;

#[derive(Clone)]
enum AuthMode {
    GatewayKey(String),
    HostedSecret(String),
}

#[derive(Clone)]
struct Config {
    auth: AuthMode,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelCallEvent {
    kind: &'static str,
    event_id: String,
    operation: String,
    provider: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    latency_ms: u64,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    service_version: &'static str,
}

#[derive(Debug, Serialize)]
struct RelayBody<T> {
    events: [T; 1],
}

fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "on" | "yes"
    )
}

fn endpoint(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.ends_with(RELAY_PATH) {
        trimmed.to_owned()
    } else {
        format!("{trimmed}{RELAY_PATH}")
    }
}

fn configured() -> Option<Config> {
    // `RYU_ANALYTICS_INGEST_*` are the least-privilege names. The existing
    // hosted fleet variables are a transition fallback so a code deploy does not
    // silently lose analytics before Dokploy's stored env is migrated.
    let url = std::env::var(INGEST_URL_ENV)
        .ok()
        .or_else(|| std::env::var(CONTROL_PLANE_URL_ENV).ok())?;
    if url.trim().is_empty() {
        return None;
    }
    if let Some(secret) = std::env::var(INGEST_SECRET_ENV)
        .ok()
        .or_else(|| std::env::var(CREDITS_SECRET_FALLBACK_ENV).ok())
        .filter(|value| !value.trim().is_empty())
    {
        return Some(Config {
            auth: AuthMode::HostedSecret(secret),
            url: endpoint(&url),
        });
    }
    let key = std::env::var(INGEST_KEY_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())?;
    if !truthy(&std::env::var(ENABLED_ENV).unwrap_or_default()) {
        return None;
    }
    Some(Config {
        auth: AuthMode::GatewayKey(key),
        url: endpoint(&url),
    })
}

fn bounded(value: &str) -> String {
    value.trim().chars().take(MAX_FIELD_LENGTH).collect()
}

/// Emit a successful or failed model-call fact without awaiting the relay.
/// `error_code` is a stable class only (never a provider message or response
/// body) and is omitted for successful calls.
pub fn emit_model_call(
    operation: &str,
    provider: &str,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    latency_ms: u64,
    outcome: &'static str,
    _error_code: Option<&str>,
) {
    static CONFIG: OnceLock<Option<Config>> = OnceLock::new();
    let Some(config) = CONFIG.get_or_init(configured).clone() else {
        return;
    };
    let event = ModelCallEvent {
        kind: "gateway_model_call",
        event_id: uuid::Uuid::new_v4().to_string(),
        operation: bounded(operation),
        provider: bounded(provider),
        model: bounded(model),
        input_tokens,
        output_tokens,
        latency_ms,
        outcome,
        error_code: _error_code.map(bounded),
        service_version: env!("CARGO_PKG_VERSION"),
    };
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut request = client
            .post(config.url)
            .timeout(REQUEST_TIMEOUT)
            .json(&RelayBody { events: [event] });
        request = match config.auth {
            AuthMode::GatewayKey(key) => request.header("x-gateway-key", key),
            AuthMode::HostedSecret(secret) => request.header("x-ryu-analytics-secret", secret),
        };
        let _ = request.send().await;
    });
}

#[cfg(test)]
mod tests {
    use super::{endpoint, truthy, ModelCallEvent};

    #[test]
    fn hosted_and_local_gates_parse_explicit_values() {
        assert!(truthy(" true "));
        assert!(truthy("1"));
        assert!(!truthy("false"));
        assert!(!truthy(""));
    }

    #[test]
    fn endpoint_adds_the_relay_path_once() {
        assert_eq!(
            endpoint("https://api.example/"),
            "https://api.example/api/telemetry/ryu"
        );
        assert_eq!(
            endpoint("https://api.example/api/telemetry/ryu"),
            "https://api.example/api/telemetry/ryu"
        );
    }

    #[test]
    fn model_event_wire_shape_is_content_free() {
        let event = ModelCallEvent {
            kind: "gateway_model_call",
            event_id: "event".to_owned(),
            operation: "chat".to_owned(),
            provider: "provider".to_owned(),
            model: "model".to_owned(),
            input_tokens: 1,
            output_tokens: 2,
            latency_ms: 3,
            outcome: "error",
            error_code: Some("all_providers_unavailable".to_owned()),
            service_version: "0.2.0",
        };
        let value = serde_json::to_value(event).expect("serialize event");
        assert_eq!(value["kind"], "gateway_model_call");
        assert_eq!(value["errorCode"], "all_providers_unavailable");
        assert!(value.get("prompt").is_none());
        assert!(value.get("requestId").is_none());
    }
}
