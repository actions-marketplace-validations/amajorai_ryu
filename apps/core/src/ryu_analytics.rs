//! Ryu-owned managed-node analytics producer.
//!
//! This is deliberately separate from `telemetry.rs`: customer diagnostics use
//! the user's OTLP destination and consent, while this producer sends a small,
//! allowlisted heartbeat to the Ryu control-plane relay only for a
//! Ryu-provisioned node and only while product analytics is enabled.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;

const BEAT_INTERVAL: Duration = Duration::from_secs(15 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const CONTROL_PLANE_URL_ENV: &str = "RYU_CONTROL_PLANE_URL";
const SERVER_URL_ENV: &str = "RYU_SERVER_URL";
const MANAGED_NODE_ENV: &str = "RYU_MANAGED_NODE";
const ANALYTICS_ENABLED_ENV: &str = "RYU_ANALYTICS_ENABLED";
const ANALYTICS_INGEST_URL_ENV: &str = "RYU_ANALYTICS_INGEST_URL";
const ANALYTICS_INGEST_KEY_ENV: &str = "RYU_ANALYTICS_INGEST_KEY";

static PRODUCT_ANALYTICS_ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Clone)]
struct RelayConfig {
    base_url: String,
    gateway_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreHeartbeat {
    kind: &'static str,
    event_id: String,
    service_version: &'static str,
    os: &'static str,
    arch: &'static str,
    managed_node: bool,
}

#[derive(Debug, Serialize)]
struct RelayBody<T> {
    events: [T; 1],
}

fn truthy(value: Option<String>) -> bool {
    value
        .map(|raw| {
            matches!(
                raw.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "on" | "yes"
            )
        })
        .unwrap_or(false)
}

fn relay_config() -> Option<RelayConfig> {
    if !truthy(std::env::var(MANAGED_NODE_ENV).ok()) {
        return None;
    }
    let base_url = std::env::var(CONTROL_PLANE_URL_ENV)
        .ok()
        .or_else(|| std::env::var(SERVER_URL_ENV).ok())?
        .trim()
        .trim_end_matches('/')
        .to_owned();
    let gateway_key = crate::sidecar::control_plane::gateway_key()?
        .trim()
        .to_owned();
    if base_url.is_empty() || gateway_key.is_empty() {
        return None;
    }
    Some(RelayConfig {
        base_url,
        gateway_key,
    })
}

fn parse_enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "on" | "yes"
    )
}

/// Seed the synchronous local-Gateway gate from Core's canonical preference.
pub async fn seed_product_analytics(prefs: &crate::server::preferences::PreferencesStore) {
    let enabled = crate::privacy::product_analytics_enabled(prefs).await;
    PRODUCT_ANALYTICS_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn product_analytics_enabled() -> bool {
    PRODUCT_ANALYTICS_ENABLED.load(Ordering::Relaxed)
}

/// Apply a live preference write before the Gateway is refreshed.
pub fn set_product_analytics_from_value(value: &str) {
    PRODUCT_ANALYTICS_ENABLED.store(parse_enabled(value), Ordering::Relaxed);
}

/// Environment passed to a Core-managed local Gateway. Ryu Axiom credentials
/// are intentionally absent; only the relay coordinates and gate are shared.
pub fn gateway_child_env() -> Vec<(String, String)> {
    if !truthy(std::env::var(MANAGED_NODE_ENV).ok()) {
        return Vec::new();
    }
    let mut env = vec![(
        ANALYTICS_ENABLED_ENV.to_owned(),
        if product_analytics_enabled() {
            "1"
        } else {
            "0"
        }
        .to_owned(),
    )];
    let base_url = std::env::var(CONTROL_PLANE_URL_ENV)
        .ok()
        .or_else(|| std::env::var(SERVER_URL_ENV).ok())
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty());
    let gateway_key = crate::sidecar::control_plane::gateway_key();
    if let (Some(base_url), Some(gateway_key)) = (base_url, gateway_key) {
        if !gateway_key.trim().is_empty() {
            env.push((
                ANALYTICS_INGEST_URL_ENV.to_owned(),
                format!("{base_url}/api/telemetry/ryu"),
            ));
            env.push((ANALYTICS_INGEST_KEY_ENV.to_owned(), gateway_key));
        }
    }
    env
}

fn relay_url(base_url: &str) -> String {
    format!("{}/api/telemetry/ryu", base_url.trim_end_matches('/'))
}

fn should_send(
    managed_node: bool,
    analytics_enabled: bool,
    gateway_key: &str,
    base_url: &str,
) -> bool {
    managed_node
        && analytics_enabled
        && !gateway_key.trim().is_empty()
        && !base_url.trim().is_empty()
}

async fn send_heartbeat(client: &reqwest::Client, config: &RelayConfig) {
    let heartbeat = CoreHeartbeat {
        kind: "core_heartbeat",
        event_id: uuid::Uuid::new_v4().to_string(),
        service_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        managed_node: true,
    };
    let response = client
        .post(relay_url(&config.base_url))
        .header("x-gateway-key", &config.gateway_key)
        .timeout(REQUEST_TIMEOUT)
        .json(&RelayBody {
            events: [heartbeat],
        })
        .send()
        .await;
    if let Err(error) = response {
        tracing::debug!(error = %error, "ryu analytics: managed Core heartbeat dropped");
    }
}

/// Spawn the managed-node heartbeat. Every tick re-reads the product-analytics
/// preference, so an in-session opt-out stops the next egress without a restart.
pub fn spawn(prefs: crate::server::preferences::PreferencesStore) {
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut interval = tokio::time::interval(BEAT_INTERVAL);
        loop {
            interval.tick().await;
            if !crate::privacy::product_analytics_enabled(&prefs).await {
                continue;
            }
            if let Some(config) = relay_config() {
                send_heartbeat(&client, &config).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{relay_url, should_send};

    #[test]
    fn managed_analytics_requires_identity_gate_and_coordinates() {
        assert!(should_send(true, true, "rgw_key", "https://api.example"));
        assert!(!should_send(false, true, "rgw_key", "https://api.example"));
        assert!(!should_send(true, false, "rgw_key", "https://api.example"));
        assert!(!should_send(true, true, "", "https://api.example"));
        assert!(!should_send(true, true, "rgw_key", ""));
    }

    #[test]
    fn relay_url_has_one_api_mount() {
        assert_eq!(
            relay_url("https://api.example/"),
            "https://api.example/api/telemetry/ryu"
        );
    }
}
