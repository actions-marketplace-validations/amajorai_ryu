//! Grok (xAI) subscription usage. Reads the access token the `grok` CLI stores in
//! `~/.grok/auth.json` and calls
//! `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` — the exact
//! call the Grok CLI's own `billing.rs` makes — plus `/v1/settings` for the plan
//! name.
//!
//! The billing response is a proto3 message serialized as JSON, so **zero-valued
//! fields are dropped entirely**: an absent `creditUsagePercent` means 0%, not a
//! schema change. A *present but non-numeric* value is drift and is refused
//! rather than clamped to zero.
//!
//! Only the shared **weekly** pool is reported. Accounts that haven't been
//! migrated to Grok's unified billing return a monthly period instead, and
//! labelling a monthly percent "Weekly" would be worse than showing nothing — so
//! those get no window (the pay-as-you-go row still renders).
//!
//! As everywhere in this crate, the token is only ever *read*: the refresh token
//! in `auth.json` is the CLI's, and rotating it would break the CLI's own next
//! refresh.
//!
//! Reconstructed from the openusage reference implementation; verify against one
//! live response before trusting blindly.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Deserialize;

use super::{
    clamp_percent, http_client, jwt_exp_unix, read_file, reason_for_status, retry_after_seconds,
    UsageMeter, UsageSnapshot, UsageUnavailable, UsageValue, UsageValueKind, UsageWindow,
};

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const SETTINGS_URL: &str = "https://cli-chat-proxy.grok.com/v1/settings";

/// The billing endpoint, with the crate's usual `#[cfg(test)]` loopback seam.
#[cfg(not(test))]
fn billing_url() -> String {
    BILLING_URL.to_string()
}
#[cfg(test)]
fn billing_url() -> String {
    std::env::var("RYU_USAGE_GROK_URL").unwrap_or_else(|_| BILLING_URL.to_string())
}

/// The settings endpoint (plan name only, best-effort).
#[cfg(not(test))]
fn settings_url() -> String {
    SETTINGS_URL.to_string()
}
#[cfg(test)]
fn settings_url() -> String {
    std::env::var("RYU_USAGE_GROK_SETTINGS_URL").unwrap_or_else(|_| SETTINGS_URL.to_string())
}

/// The header the proxy expects alongside the bearer token, identifying the CLI.
const TOKEN_AUTH_HEADER: &str = "xai-grok-cli";
/// The period type that identifies the shared weekly pool.
const WEEKLY_PERIOD_TYPE: &str = "USAGE_PERIOD_TYPE_WEEKLY";
/// Treat a token within this slack of expiry as already expired, so we skip a
/// call that's about to 401.
const EXPIRY_SLACK_SECS: i64 = 5 * 60;

/// One `auth.json` entry. `key` is the access token; the rest we read only to
/// judge freshness (never to refresh).
#[derive(Debug, Deserialize)]
struct AuthEntry {
    key: Option<String>,
    #[serde(rename = "expires_at")]
    expires_at: Option<String>,
    expires: Option<String>,
}

/// `~/.grok/auth.json`, honouring the `GROK_HOME` override the CLI uses.
fn auth_path() -> PathBuf {
    let home = std::env::var("GROK_HOME")
        .ok()
        .map(|dir| dir.trim().to_string())
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".grok")
        });
    home.join("auth.json")
}

/// The first entry carrying a non-empty access token. `auth.json` is a map of
/// opaque account keys to entries; a `BTreeMap` makes the pick deterministic
/// (lowest key wins) instead of depending on hash order.
fn load_auth() -> Option<AuthEntry> {
    let text = read_file(&auth_path())?;
    let parsed: BTreeMap<String, AuthEntry> = serde_json::from_str(&text).ok()?;
    parsed.into_values().find(|entry| {
        entry
            .key
            .as_deref()
            .is_some_and(|key| !key.trim().is_empty())
    })
}

/// Whether the stored token has already expired, judged locally from the JWT's
/// own `exp` and the entry's recorded expiry. Unknown expiry → assume fresh and
/// let the endpoint be the judge.
fn is_expired(entry: &AuthEntry, token: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    if let Some(exp) = jwt_exp_unix(token) {
        if exp - now <= EXPIRY_SLACK_SECS {
            return true;
        }
    }
    let recorded = entry
        .expires_at
        .as_deref()
        .or(entry.expires.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    recorded.is_some_and(|at| at.timestamp() - now <= EXPIRY_SLACK_SECS)
}

pub(super) async fn fetch(agent_id: &str) -> UsageSnapshot {
    let unavailable =
        |reason: UsageUnavailable| UsageSnapshot::unavailable(agent_id, "grok", reason);

    let Some(entry) = load_auth() else {
        return unavailable(UsageUnavailable::NotLoggedIn);
    };
    let Some(token) = entry
        .key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    else {
        return unavailable(UsageUnavailable::NotLoggedIn);
    };
    // NEVER refresh — the refresh token belongs to the CLI.
    if is_expired(&entry, token) {
        return unavailable(UsageUnavailable::TokenExpired);
    }

    let resp = match get(&billing_url(), token).await {
        Ok(r) => r,
        Err(_) => return unavailable(UsageUnavailable::Error),
    };
    if !resp.status().is_success() {
        let reason = reason_for_status(resp.status());
        let retry_after = retry_after_seconds(resp.headers());
        let mut snapshot = unavailable(reason);
        snapshot.retry_after_seconds = retry_after;
        return snapshot;
    }
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return unavailable(UsageUnavailable::Error);
    };
    let Some(config) = credits_config(&body) else {
        return unavailable(UsageUnavailable::Error);
    };

    // The plan name is a nice-to-have on a second endpoint: a failure here must
    // not cost us the meter we already have.
    let plan = match get(&settings_url(), token).await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|settings| plan_name(&settings)),
        _ => None,
    };

    let mut snapshot = UsageSnapshot::available(agent_id, "grok", plan);
    if config.is_weekly {
        snapshot.windows.push(UsageWindow {
            label: "Weekly".to_string(),
            used_percent: clamp_percent(config.used_percent),
            resets_at: Some(config.period_end.to_rfc3339()),
            window_seconds: Some((config.period_end - config.period_start).num_seconds()),
            model: None,
        });
    }
    snapshot
        .meters
        .push(pay_as_you_go_meter(config.on_demand_cap));
    snapshot
}

async fn get(url: &str, token: &str) -> Result<reqwest::Response, reqwest::Error> {
    http_client()
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("X-XAI-Token-Auth", TOKEN_AUTH_HEADER)
        .header("Accept", "application/json")
        .header("User-Agent", "Ryu")
        .send()
        .await
}

/// The slice of Grok's credits config we render.
struct CreditsConfig {
    is_weekly: bool,
    used_percent: f64,
    period_start: chrono::DateTime<chrono::Utc>,
    period_end: chrono::DateTime<chrono::Utc>,
    on_demand_cap: f64,
}

/// Decode `{ config: { creditUsagePercent, currentPeriod: { type, start, end },
/// onDemandCap: { val } } }`.
///
/// A missing config/period, malformed timestamps, or a period that doesn't move
/// forward is a refusal — the server answered, but not in a shape we know.
/// Absent `creditUsagePercent` / `onDemandCap` are genuine zeroes (proto-JSON
/// drops zero-valued fields), but a *present* non-numeric value is drift.
fn credits_config(body: &serde_json::Value) -> Option<CreditsConfig> {
    let config = body.get("config")?;
    let period = config.get("currentPeriod")?;
    let period_type = period
        .get("type")
        .and_then(serde_json::Value::as_str)?
        .trim();
    if period_type.is_empty() {
        return None;
    }
    let period_start = rfc3339(period.get("start"))?;
    let period_end = rfc3339(period.get("end"))?;
    if period_end <= period_start {
        return None;
    }

    let used_percent = match config.get("creditUsagePercent") {
        Some(raw) => raw
            .as_f64()
            .filter(|percent| percent.is_finite())
            // Present but unusable => drift, not 0%.
            .map(Some)?,
        None => Some(0.0),
    }?;

    let on_demand_cap = match config.get("onDemandCap") {
        Some(raw) => raw
            .get("val")
            .map_or(Some(0.0), |val| val.as_f64().filter(|v| v.is_finite()))?,
        None => 0.0,
    };

    Some(CreditsConfig {
        is_weekly: period_type == WEEKLY_PERIOD_TYPE,
        used_percent,
        period_start,
        period_end,
        on_demand_cap,
    })
}

fn rfc3339(value: Option<&serde_json::Value>) -> Option<chrono::DateTime<chrono::Utc>> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// The pay-as-you-go row: the cap in credits, or a real zero meaning "disabled"
/// (proto-JSON omits a zero cap, so absent and zero are the same state).
fn pay_as_you_go_meter(cap: f64) -> UsageMeter {
    UsageMeter::new(
        "Pay as you go",
        vec![UsageValue::new(
            cap.max(0.0),
            UsageValueKind::Count,
            Some("cap"),
        )],
    )
}

/// `subscription_tier_display` from `/v1/settings`.
fn plan_name(settings: &serde_json::Value) -> Option<String> {
    let raw = settings
        .get("subscription_tier_display")
        .and_then(serde_json::Value::as_str)?
        .trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{spawn_loopback, spawn_loopback_with_headers};

    // GROK_HOME + RYU_USAGE_GROK_* are process-global; serialize env-touching tests.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn write_auth(dir: &std::path::Path, body: &str) {
        std::env::set_var("GROK_HOME", dir);
        std::fs::write(dir.join("auth.json"), body).unwrap();
    }

    fn clear_env() {
        std::env::remove_var("GROK_HOME");
        std::env::remove_var("RYU_USAGE_GROK_URL");
        std::env::remove_var("RYU_USAGE_GROK_SETTINGS_URL");
    }

    /// Point the settings fetch at a closed port so a test observes the
    /// plan-is-best-effort path rather than the real endpoint.
    fn disable_settings() {
        std::env::set_var("RYU_USAGE_GROK_SETTINGS_URL", "http://127.0.0.1:1/settings");
    }

    fn weekly_body() -> serde_json::Value {
        serde_json::json!({ "config": {
            "creditUsagePercent": 61.5,
            "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY",
                "start": "2026-07-03T04:01:09.238389+00:00",
                "end": "2026-07-10T04:01:09.238389+00:00"
            },
            "onDemandCap": { "val": 2500 },
            "isUnifiedBillingUser": true
        }})
    }

    // ── auth ─────────────────────────────────────────────────────────────────

    #[test]
    fn auth_path_honours_grok_home() {
        let _g = lock();
        std::env::set_var("GROK_HOME", "/tmp/xyz-grok");
        assert_eq!(auth_path(), PathBuf::from("/tmp/xyz-grok/auth.json"));
        std::env::set_var("GROK_HOME", "   ");
        assert!(auth_path().ends_with(".grok/auth.json"), "blank falls back");
        clear_env();
    }

    #[test]
    fn load_auth_picks_the_lowest_key_with_a_token() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(
            dir.path(),
            r#"{"z::client":{"key":"tok-z"},"a::client":{"key":"tok-a"},"empty":{"key":"  "}}"#,
        );
        assert_eq!(load_auth().and_then(|e| e.key).as_deref(), Some("tok-a"));
        // A file with no usable token at all reads as not-logged-in.
        write_auth(dir.path(), r#"{"only":{"key":""}}"#);
        assert!(load_auth().is_none());
        write_auth(dir.path(), "not json");
        assert!(load_auth().is_none());
        clear_env();
    }

    #[test]
    fn is_expired_reads_jwt_exp_then_recorded_expiry() {
        use base64::Engine as _;
        let jwt = |exp: i64| {
            let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(format!(r#"{{"exp":{exp}}}"#).as_bytes());
            format!("h.{payload}.s")
        };
        let now = chrono::Utc::now().timestamp();
        let fresh = AuthEntry {
            key: None,
            expires_at: None,
            expires: None,
        };
        assert!(is_expired(&fresh, &jwt(now - 10)));
        assert!(!is_expired(&fresh, &jwt(now + 3600)));
        // Opaque token, expiry recorded on the entry instead.
        let past = AuthEntry {
            key: None,
            expires_at: Some((chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339()),
            expires: None,
        };
        assert!(is_expired(&past, "opaque"));
        let future = AuthEntry {
            key: None,
            expires_at: None,
            expires: Some((chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339()),
        };
        assert!(!is_expired(&future, "opaque"));
        // Nothing to judge by → assume fresh, let the endpoint decide.
        assert!(!is_expired(&fresh, "opaque"));
    }

    // ── credits config ───────────────────────────────────────────────────────

    #[test]
    fn credits_config_reads_the_weekly_pool() {
        let config = credits_config(&weekly_body()).expect("config");
        assert!(config.is_weekly);
        assert_eq!(config.used_percent, 61.5);
        assert_eq!(config.on_demand_cap, 2500.0);
        assert_eq!(
            (config.period_end - config.period_start).num_seconds(),
            7 * 24 * 60 * 60
        );
    }

    #[test]
    fn credits_config_treats_omitted_zero_fields_as_zero() {
        // proto-JSON drops zero values: no percent and no cap means 0% and disabled.
        let body = serde_json::json!({ "config": { "currentPeriod": {
            "type": "USAGE_PERIOD_TYPE_WEEKLY",
            "start": "2026-07-03T00:00:00Z",
            "end": "2026-07-10T00:00:00Z"
        }}});
        let config = credits_config(&body).expect("config");
        assert_eq!(config.used_percent, 0.0);
        assert_eq!(config.on_demand_cap, 0.0);
    }

    #[test]
    fn credits_config_refuses_drift_rather_than_reading_zero() {
        let cases = [
            // Present but non-numeric percent — a schema change, not 0%.
            serde_json::json!({ "config": { "creditUsagePercent": "high", "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY", "start": "2026-07-03T00:00:00Z", "end": "2026-07-10T00:00:00Z" }}}),
            // Cap present but non-numeric.
            serde_json::json!({ "config": { "onDemandCap": { "val": "lots" }, "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY", "start": "2026-07-03T00:00:00Z", "end": "2026-07-10T00:00:00Z" }}}),
            // Period that doesn't move forward.
            serde_json::json!({ "config": { "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY", "start": "2026-07-10T00:00:00Z", "end": "2026-07-10T00:00:00Z" }}}),
            // Malformed timestamps / missing type / missing config.
            serde_json::json!({ "config": { "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY", "start": "nope", "end": "nope" }}}),
            serde_json::json!({ "config": { "currentPeriod": { "type": "", "start": "2026-07-03T00:00:00Z", "end": "2026-07-10T00:00:00Z" }}}),
            serde_json::json!({}),
        ];
        for body in cases {
            assert!(credits_config(&body).is_none(), "{body} should be refused");
        }
    }

    #[test]
    fn plan_name_reads_the_display_tier() {
        let settings = serde_json::json!({ "subscription_tier_display": "SuperGrok Heavy" });
        assert_eq!(plan_name(&settings).as_deref(), Some("SuperGrok Heavy"));
        assert!(plan_name(&serde_json::json!({ "subscription_tier_display": " " })).is_none());
        assert!(plan_name(&serde_json::json!({})).is_none());
    }

    #[test]
    fn pay_as_you_go_meter_shows_the_cap_or_a_real_zero() {
        assert_eq!(pay_as_you_go_meter(2500.0).values[0].number, 2500.0);
        assert_eq!(pay_as_you_go_meter(0.0).values[0].number, 0.0);
        // A negative cap is nonsense; clamp rather than render it.
        assert_eq!(pay_as_you_go_meter(-3.0).values[0].number, 0.0);
    }

    // ── fetch end-to-end via loopback server ─────────────────────────────────

    #[tokio::test]
    async fn fetch_not_logged_in_without_auth_file() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("GROK_HOME", dir.path());
        let snap = fetch("acp:grok").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::NotLoggedIn)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_builds_weekly_window_and_cap_meter() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"a::client":{"key":"opaque"}}"#);
        let url = spawn_loopback(
            "200 OK",
            r#"{"config":{"creditUsagePercent":61.5,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-07-03T04:01:09.238389+00:00","end":"2026-07-10T04:01:09.238389+00:00"},"onDemandCap":{"val":2500}}}"#,
        );
        std::env::set_var("RYU_USAGE_GROK_URL", &url);
        let settings = spawn_loopback("200 OK", r#"{"subscription_tier_display":"SuperGrok"}"#);
        std::env::set_var("RYU_USAGE_GROK_SETTINGS_URL", &settings);

        let snap = fetch("acp:grok").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.engine, "grok");
        assert_eq!(snap.plan.as_deref(), Some("SuperGrok"));
        assert_eq!(snap.windows.len(), 1);
        assert_eq!(snap.windows[0].label, "Weekly");
        assert_eq!(snap.windows[0].used_percent, 61.5);
        assert_eq!(snap.windows[0].window_seconds, Some(7 * 24 * 60 * 60));
        assert_eq!(snap.meters[0].label, "Pay as you go");
        assert_eq!(snap.meters[0].values[0].number, 2500.0);
        clear_env();
    }

    /// A non-weekly (legacy monthly-billing) account has no shared weekly pool —
    /// showing its monthly percent as "Weekly" would be a lie, so no window.
    #[tokio::test]
    async fn fetch_omits_the_window_for_a_non_weekly_period() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"a::client":{"key":"opaque"}}"#);
        let url = spawn_loopback(
            "200 OK",
            r#"{"config":{"creditUsagePercent":40.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_MONTHLY","start":"2026-07-01T00:00:00Z","end":"2026-08-01T00:00:00Z"}}}"#,
        );
        std::env::set_var("RYU_USAGE_GROK_URL", &url);
        disable_settings();

        let snap = fetch("acp:grok").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert!(snap.windows.is_empty());
        // The pay-as-you-go row still renders (absent cap => disabled => 0).
        assert_eq!(snap.meters[0].values[0].number, 0.0);
        assert!(snap.plan.is_none(), "settings failure must not be fatal");
        clear_env();
    }

    #[tokio::test]
    async fn fetch_maps_401_and_429() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"a::client":{"key":"opaque"}}"#);
        let url = spawn_loopback("401 Unauthorized", "{}");
        std::env::set_var("RYU_USAGE_GROK_URL", &url);
        assert!(matches!(
            fetch("acp:grok").await.reason,
            Some(UsageUnavailable::TokenExpired)
        ));

        let url = spawn_loopback_with_headers("429 Too Many Requests", "Retry-After: 30\r\n", "{}");
        std::env::set_var("RYU_USAGE_GROK_URL", &url);
        let snap = fetch("acp:grok").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::RateLimited)));
        assert_eq!(snap.retry_after_seconds, Some(30));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_unknown_body_shape_is_error() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"a::client":{"key":"opaque"}}"#);
        // 200 with a body we don't recognize: refuse rather than invent zeroes.
        let url = spawn_loopback("200 OK", r#"{"unexpected":true}"#);
        std::env::set_var("RYU_USAGE_GROK_URL", &url);
        let snap = fetch("acp:grok").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::Error)));
        clear_env();
    }
}
