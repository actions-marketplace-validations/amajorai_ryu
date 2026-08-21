//! Treg's public catalog adapter for the unified Integrations Store.
//!
//! Treg's catalog is intentionally separate from Treg execution. Catalog
//! browsing is public and needs no provider key; executing a Treg call still
//! belongs to a Treg account/token and is not implied by a row in Marketplace.
//! Keeping this adapter read-only lets a self-hosted Treg catalog be selected
//! with one URL without moving provider credentials through Ryu Core.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::catalog_source::{IntegrationOption, IntegrationPrice};

const DEFAULT_BASE_URL: &str = "https://treg.to";
const BASE_URL_ENV: &str = "RYU_TREG_CATALOG_URL";
const TTL_ENV: &str = "RYU_TREG_CATALOG_CACHE_TTL_SECS";
const DEFAULT_TTL_SECS: u64 = 24 * 60 * 60;

static PLATFORMS_CACHE: OnceLock<tokio::sync::Mutex<Option<PlatformsCache>>> = OnceLock::new();
static DETAILS_CACHE: OnceLock<tokio::sync::Mutex<HashMap<String, DetailCache>>> = OnceLock::new();

#[derive(Clone)]
struct PlatformsCache {
    fetched_at: Instant,
    platforms: Vec<TregPlatformSummary>,
}

#[derive(Clone)]
struct DetailCache {
    fetched_at: Instant,
    options: Vec<IntegrationOption>,
}

#[derive(Debug, Clone)]
pub(crate) struct TregPlatformSummary {
    pub slug: String,
    pub label: String,
    pub category: Option<String>,
    pub summary: Option<String>,
    pub capabilities: Option<u64>,
    pub endpoints: Option<u64>,
    pub price: Option<IntegrationPrice>,
}

/// The active Treg catalog base. A self-hosted Treg deployment can expose the
/// same `/catalog/*` routes and be selected without changing the application.
pub(crate) fn base_url() -> String {
    std::env::var(BASE_URL_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_owned())
}

fn cache_ttl() -> Duration {
    let seconds = std::env::var(TTL_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_TTL_SECS);
    Duration::from_secs(seconds)
}

async fn fetch_json(path: &str) -> Result<Value> {
    let url = format!("{}{path}", base_url());
    let bytes = crate::server::guarded_get_bytes(&url)
        .await
        .map_err(|error| anyhow!("fetching Treg catalog {url}: {error}"))?;
    serde_json::from_slice(&bytes)
        .with_context(|| format!("parsing Treg catalog response from {url}"))
}

pub(crate) async fn platform_summaries() -> Result<Vec<TregPlatformSummary>> {
    let lock = PLATFORMS_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    {
        let guard = lock.lock().await;
        if let Some(cache) = guard
            .as_ref()
            .filter(|cache| cache.fetched_at.elapsed() < cache_ttl())
        {
            return Ok(cache.platforms.clone());
        }
    }

    let body = fetch_json("/catalog/platforms").await?;
    let platforms = body
        .get("platforms")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Treg catalog response has no platforms array"))?
        .iter()
        .filter_map(parse_platform_summary)
        .collect::<Vec<_>>();

    let mut guard = lock.lock().await;
    if let Some(cache) = guard
        .as_ref()
        .filter(|cache| cache.fetched_at.elapsed() < cache_ttl())
    {
        return Ok(cache.platforms.clone());
    }
    *guard = Some(PlatformsCache {
        fetched_at: Instant::now(),
        platforms: platforms.clone(),
    });
    Ok(platforms)
}

pub(crate) async fn platform_options(slug: &str) -> Result<Vec<IntegrationOption>> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err(anyhow!("Treg platform slug is empty"));
    }

    let lock = DETAILS_CACHE.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    {
        let guard = lock.lock().await;
        if let Some(cache) = guard
            .get(slug)
            .filter(|cache| cache.fetched_at.elapsed() < cache_ttl())
        {
            return Ok(cache.options.clone());
        }
    }

    let body = fetch_json(&format!("/catalog/platforms/{}", urlencoding::encode(slug))).await?;
    let options = parse_platform_options(&body);
    let mut guard = lock.lock().await;
    if let Some(cache) = guard
        .get(slug)
        .filter(|cache| cache.fetched_at.elapsed() < cache_ttl())
    {
        return Ok(cache.options.clone());
    }
    guard.insert(
        slug.to_owned(),
        DetailCache {
            fetched_at: Instant::now(),
            options: options.clone(),
        },
    );
    Ok(options)
}

fn parse_platform_summary(value: &Value) -> Option<TregPlatformSummary> {
    let slug = string_field(value, &["slug"])?;
    let label = string_field(value, &["label", "name"]).unwrap_or_else(|| slug.clone());
    let capabilities = count_field(value.get("capabilities"));
    let endpoints = count_field(value.get("endpoints"));
    Some(TregPlatformSummary {
        slug,
        label,
        category: string_field(value, &["category"]),
        summary: string_field(value, &["summary", "description"]),
        capabilities,
        endpoints,
        price: value.get("price_from").and_then(parse_price),
    })
}

fn parse_platform_options(body: &Value) -> Vec<IntegrationOption> {
    let mut options = Vec::new();
    let mut seen = HashSet::new();

    if let Some(domains) = body.get("domains").and_then(Value::as_array) {
        for domain in domains {
            let Some(rows) = domain.get("rows").and_then(Value::as_array) else {
                continue;
            };
            for row in rows {
                let Some(endpoints) = row.get("endpoints").and_then(Value::as_array) else {
                    continue;
                };
                for endpoint in endpoints {
                    push_endpoint_option(endpoint, &mut seen, &mut options);
                }
            }
        }
    }

    // Older/self-hosted Treg catalog responses may omit the domain projection;
    // capabilities is the equivalent endpoint list, and the id set keeps this
    // fallback from duplicating rows when both projections are present.
    if let Some(capabilities) = body.get("capabilities").and_then(Value::as_array) {
        for capability in capabilities {
            let Some(endpoints) = capability.get("endpoints").and_then(Value::as_array) else {
                continue;
            };
            for endpoint in endpoints {
                push_endpoint_option(endpoint, &mut seen, &mut options);
            }
        }
    }

    options
}

fn push_endpoint_option(
    endpoint: &Value,
    seen: &mut HashSet<String>,
    options: &mut Vec<IntegrationOption>,
) {
    let Some(id) = string_field(endpoint, &["id"]) else {
        return;
    };
    if !seen.insert(id.clone()) {
        return;
    }
    let summary = string_field(endpoint, &["summary", "description"]);
    let name = string_field(endpoint, &["name"])
        .or_else(|| summary.clone())
        .unwrap_or_else(|| id.clone());
    let capability = string_field(endpoint, &["capability"]);
    let provider = string_field(endpoint, &["provider_display", "provider"]);
    let availability_note = string_field(endpoint, &["platform_blocked"]);
    let available = endpoint.get("platform_eligible").and_then(Value::as_bool);
    let url = Some(format!(
        "{}/catalog/endpoints/{}",
        base_url(),
        urlencoding::encode(&id)
    ));

    options.push(IntegrationOption {
        id,
        source: "treg".to_owned(),
        kind: "treg-endpoint".to_owned(),
        action: "chat-setup".to_owned(),
        connection_id: None,
        name,
        description: summary,
        url,
        provider,
        capability: capability.clone(),
        comparison_key: capability,
        price: endpoint.get("cost").and_then(parse_price),
        is_cheapest: false,
        available,
        availability_note,
    });
}

fn parse_price(value: &Value) -> Option<IntegrationPrice> {
    let usd = number_field(value, &["usd"]);
    let currency = string_field(value, &["currency"]);
    let value_amount = number_field(value, &["value"]);
    let per = number_field(value, &["per"]);
    let unit = string_field(value, &["unit"]);
    let confidence = string_field(value, &["confidence"]);
    if usd.is_none()
        && currency.is_none()
        && value_amount.is_none()
        && per.is_none()
        && unit.is_none()
    {
        return None;
    }
    Some(IntegrationPrice {
        usd,
        currency,
        value: value_amount,
        per,
        unit,
        confidence,
    })
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
}

fn count_field(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_array().map(|items| items.len() as u64))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_platform_summary_and_price() {
        let value = json!({
            "slug": "x",
            "label": "X (Twitter)",
            "category": "Social",
            "summary": "Profiles and posts",
            "capabilities": 96,
            "endpoints": 147,
            "price_from": {
                "value": 0.001,
                "currency": "USD",
                "per": 1,
                "unit": "call",
                "usd": 0.001,
                "confidence": "verified"
            }
        });
        let summary = parse_platform_summary(&value).expect("platform summary");
        assert_eq!(summary.slug, "x");
        assert_eq!(summary.capabilities, Some(96));
        assert_eq!(
            summary.price.as_ref().and_then(|price| price.usd),
            Some(0.001)
        );
    }

    #[test]
    fn flattens_and_deduplicates_treg_endpoint_projections() {
        let value = json!({
            "domains": [{
                "rows": [{
                    "endpoints": [{
                        "id": "x.user.profile",
                        "provider": "tikhub",
                        "provider_display": "TikHub",
                        "summary": "Profile",
                        "capability": "profile",
                        "platform_eligible": true,
                        "cost": {"usd": 0.001, "unit": "call", "currency": "USD"}
                    }]
                }]
            }],
            "capabilities": [{
                "endpoints": [{
                    "id": "x.user.profile",
                    "summary": "Profile"
                }]
            }]
        });
        let options = parse_platform_options(&value);
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].source, "treg");
        assert_eq!(options[0].provider.as_deref(), Some("TikHub"));
        assert_eq!(options[0].comparison_key.as_deref(), Some("profile"));
    }
}
