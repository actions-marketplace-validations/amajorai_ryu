//! Z.ai (Zhipu) GLM Coding Plan usage — the `acp:glm` agent's subscription.
//!
//! Z.ai ships no companion CLI whose credential we could reuse, so this is the
//! one reader in the crate that needs an **API key**. It is read from the
//! environment (`ZAI_API_KEY`, or the legacy `GLM_API_KEY` Zhipu still accepts)
//! or from `~/.config/zai/key.json`; with no key the snapshot is `not_logged_in`
//! and the bar simply hides.
//!
//! Two undocumented internal endpoints — the same ones Z.ai's own subscription UI
//! calls, stable in practice:
//!
//! - `GET https://api.z.ai/api/monitor/usage/quota/limit` — the quota meters. The
//!   `limits` array encodes each window as a `(unit, number)` pair, so a
//!   `TOKENS_LIMIT` entry is classified by the window it *reports* (sub-daily →
//!   Session, multi-day → Weekly) rather than by position, and a `TIME_LIMIT`
//!   entry is the monthly web-search / web-reader / Zread count.
//! - `GET https://api.z.ai/api/biz/subscription/list` — the plan name,
//!   best-effort (a failure here must not blank the meters).
//!
//! A valid key on an account with no GLM Coding Plan answers `success: false`
//! with a "coding plan" message; that becomes [`UsageUnavailable::NoPlan`] —
//! distinct from an error, because nothing is broken. (Today's desktop bar hides
//! on every unavailable reason alike; the distinct reason is on the wire for a
//! surface that wants to explain it.) A missing required usage value is reported
//! as an error rather than shown as zero.
//!
//! Reconstructed from the openusage reference implementation; verify against one
//! live response before trusting blindly.

use std::path::PathBuf;

use super::{
    clamp_percent, epoch_millis_to_rfc3339, http_client, read_file, reason_for_status,
    retry_after_seconds, UsageMeter, UsageSnapshot, UsageUnavailable, UsageValue, UsageValueKind,
    UsageWindow,
};

const QUOTA_URL: &str = "https://api.z.ai/api/monitor/usage/quota/limit";
const SUBSCRIPTION_URL: &str = "https://api.z.ai/api/biz/subscription/list";

/// The quota endpoint, with the crate's usual `#[cfg(test)]` loopback seam.
#[cfg(not(test))]
fn quota_url() -> String {
    QUOTA_URL.to_string()
}
#[cfg(test)]
fn quota_url() -> String {
    std::env::var("RYU_USAGE_GLM_URL").unwrap_or_else(|_| QUOTA_URL.to_string())
}

/// The subscription (plan name) endpoint.
#[cfg(not(test))]
fn subscription_url() -> String {
    SUBSCRIPTION_URL.to_string()
}
#[cfg(test)]
fn subscription_url() -> String {
    std::env::var("RYU_USAGE_GLM_SUBSCRIPTION_URL").unwrap_or_else(|_| SUBSCRIPTION_URL.to_string())
}

/// A day, in milliseconds — the cutoff between a Session window and a Weekly one.
const DAY_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
/// The monthly web-search cycle, in seconds. Only a fallback: the payload's own
/// `nextResetTime` is used when present.
const MONTHLY_WINDOW_SECS: i64 = 30 * 24 * 60 * 60;

/// The API key, from the environment first (how a headless/CI node supplies it)
/// then the on-disk file Z.ai tooling writes.
fn load_api_key() -> Option<String> {
    for var in ["ZAI_API_KEY", "GLM_API_KEY"] {
        if let Some(key) = std::env::var(var)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            return Some(key);
        }
    }
    let text = read_file(&key_path())?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    // Both spellings have shipped; accept either rather than failing on casing.
    ["apiKey", "api_key"]
        .iter()
        .filter_map(|field| parsed.get(*field).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|key| !key.is_empty())
        .map(str::to_string)
}

fn key_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("zai")
        .join("key.json")
}

pub(super) async fn fetch(agent_id: &str) -> UsageSnapshot {
    let unavailable =
        |reason: UsageUnavailable| UsageSnapshot::unavailable(agent_id, "glm", reason);

    let Some(api_key) = load_api_key() else {
        return unavailable(UsageUnavailable::NotLoggedIn);
    };

    let resp = match get(&quota_url(), &api_key).await {
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
    // A valid key with no coding plan: nothing to meter, and saying so beats
    // three blank bars.
    if is_no_coding_plan(&body) {
        return unavailable(UsageUnavailable::NoPlan);
    }
    let Some(quota) = map_quota(&body) else {
        return unavailable(UsageUnavailable::Error);
    };

    // Plan name is best-effort on a second endpoint.
    let plan = match get(&subscription_url(), &api_key).await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| plan_name(&body)),
        _ => None,
    };

    let mut snapshot = UsageSnapshot::available(agent_id, "glm", plan);
    snapshot.windows = quota.windows;
    snapshot.meters = quota.meters;
    snapshot
}

async fn get(url: &str, api_key: &str) -> Result<reqwest::Response, reqwest::Error> {
    http_client()
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .header("User-Agent", "Ryu")
        .send()
        .await
}

/// True for the "valid key, but no GLM Coding Plan" signal: Z.ai answers 200 with
/// `{"success":false,"code":500,"msg":"…coding plan"}` and no `data`. Matched on
/// the structured `success: false` *plus* the phrase the message carries (ASCII
/// even in the localized string), so an unrelated business failure doesn't trip it.
fn is_no_coding_plan(body: &serde_json::Value) -> bool {
    if body.get("success").and_then(serde_json::Value::as_bool) != Some(false) {
        return false;
    }
    body.get("msg")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|msg| msg.to_ascii_lowercase().contains("coding plan"))
}

struct Quota {
    windows: Vec<UsageWindow>,
    meters: Vec<UsageMeter>,
}

/// The Session / Weekly percent windows plus the monthly web-search count.
///
/// `None` when the payload isn't the shape we know (no `limits` array, or a
/// recognized limit whose required values are missing) — an unreadable quota is
/// reported as an error rather than rendered as zero usage. An *explicitly empty*
/// limits array is a valid "no data yet" state and yields empty meters.
fn map_quota(body: &serde_json::Value) -> Option<Quota> {
    // The array lives under `data.limits`; older payloads put it at the root.
    let container = match body.get("data") {
        Some(data) => {
            if !data.is_object() {
                return None;
            }
            data
        }
        None => body,
    };
    let limits = container.get("limits")?.as_array()?;
    let mut quota = Quota {
        windows: Vec::new(),
        meters: Vec::new(),
    };
    if limits.is_empty() {
        return Some(quota);
    }

    for entry in limits.iter().filter(|entry| is_kind(entry, "TOKENS_LIMIT")) {
        // An unknown unit is skipped so a future Z.ai window can't hide the
        // meters we do understand; a *known* unit with no percentage is drift.
        let Some(period_ms) = window_millis(entry) else {
            continue;
        };
        let used_percent = entry
            .get("percentage")
            .and_then(serde_json::Value::as_f64)?;
        quota.windows.push(UsageWindow {
            label: window_label(period_ms),
            used_percent: clamp_percent(used_percent),
            resets_at: next_reset(entry),
            window_seconds: Some((period_ms / 1000.0) as i64),
            model: None,
        });
    }

    if let Some(entry) = limits.iter().find(|entry| is_kind(entry, "TIME_LIMIT")) {
        // `currentValue` is the count used, `usage` the monthly allowance.
        let used = entry
            .get("currentValue")
            .and_then(serde_json::Value::as_f64)
            .filter(|used| *used >= 0.0)?;
        let limit = entry
            .get("usage")
            .and_then(serde_json::Value::as_f64)
            .filter(|limit| *limit >= 0.0)?;
        quota.meters.push(
            UsageMeter::new(
                "Web searches",
                vec![
                    UsageValue::new(used, UsageValueKind::Count, Some("used")),
                    UsageValue::new(limit, UsageValueKind::Count, Some("limit")),
                ],
            )
            .with_resets_at(next_reset(entry).or_else(|| {
                Some(
                    (chrono::Utc::now() + chrono::Duration::seconds(MONTHLY_WINDOW_SECS))
                        .to_rfc3339(),
                )
            })),
        );
    }

    Some(quota)
}

/// A limit entry's kind. Z.ai's payload has carried it in either `type` or
/// `name` across revisions, so both are checked.
fn is_kind(entry: &serde_json::Value, kind: &str) -> bool {
    ["type", "name"]
        .iter()
        .filter_map(|field| entry.get(*field).and_then(serde_json::Value::as_str))
        .any(|value| value == kind)
}

/// The label for a token window of `period_ms`.
///
/// Only the two canonical rolling windows get the shared cross-vendor names; a
/// window in between is named for its own length. Collapsing everything ≥ a day
/// into "Weekly" (openusage's rule) would call a *daily* cap "Weekly" — the same
/// class of lie the Codex slot-vs-duration and Grok monthly-as-weekly paths
/// deliberately avoid — and would emit two rows sharing one label for a plan that
/// reports both a daily and a weekly cap.
fn window_label(period_ms: f64) -> String {
    if period_ms < DAY_MS {
        return "Session".to_string();
    }
    let days = (period_ms / DAY_MS).round() as i64;
    match days {
        1 => "Daily".to_string(),
        7 => "Weekly".to_string(),
        30 | 31 => "Monthly".to_string(),
        _ => format!("{days}-day"),
    }
}

/// A window's length in milliseconds from its `(unit, number)` pair: unit 3 is
/// hours, 4 days, 5 months, 6 weeks. `None` for an unrecognized unit or a
/// non-positive count.
fn window_millis(entry: &serde_json::Value) -> Option<f64> {
    let unit = entry.get("unit").and_then(serde_json::Value::as_f64)?;
    let number = entry
        .get("number")
        .and_then(serde_json::Value::as_f64)
        .filter(|number| *number > 0.0)?;
    let unit_ms = match unit as i64 {
        3 => 60.0 * 60.0 * 1000.0,
        4 => DAY_MS,
        5 => 30.0 * DAY_MS,
        6 => 7.0 * DAY_MS,
        _ => return None,
    };
    let duration = unit_ms * number;
    if duration.is_finite() && duration >= 1.0 {
        Some(duration)
    } else {
        None
    }
}

/// `nextResetTime`, epoch milliseconds → RFC3339.
fn next_reset(entry: &serde_json::Value) -> Option<String> {
    entry
        .get("nextResetTime")
        .and_then(serde_json::Value::as_f64)
        .and_then(epoch_millis_to_rfc3339)
}

/// `productName` from the first subscription entry (e.g. "GLM Coding Max").
fn plan_name(body: &serde_json::Value) -> Option<String> {
    let raw = body
        .get("data")?
        .as_array()?
        .first()?
        .get("productName")?
        .as_str()?
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

    // The API-key env vars and the URL overrides are process-global; serialize.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn clear_env() {
        for var in [
            "ZAI_API_KEY",
            "GLM_API_KEY",
            "RYU_USAGE_GLM_URL",
            "RYU_USAGE_GLM_SUBSCRIPTION_URL",
        ] {
            std::env::remove_var(var);
        }
    }

    /// Point the plan lookup at a closed port so a test observes the
    /// plan-is-best-effort path rather than the real endpoint.
    fn disable_subscription() {
        std::env::set_var("RYU_USAGE_GLM_SUBSCRIPTION_URL", "http://127.0.0.1:1/plan");
    }

    // ── credential discovery ─────────────────────────────────────────────────

    #[test]
    fn load_api_key_prefers_zai_then_glm_env() {
        let _g = lock();
        clear_env();
        std::env::set_var("GLM_API_KEY", "legacy");
        assert_eq!(load_api_key().as_deref(), Some("legacy"));
        std::env::set_var("ZAI_API_KEY", "current");
        assert_eq!(load_api_key().as_deref(), Some("current"));
        // A blank value doesn't count as set.
        std::env::set_var("ZAI_API_KEY", "   ");
        assert_eq!(load_api_key().as_deref(), Some("legacy"));
        clear_env();
    }

    // ── quota mapping ────────────────────────────────────────────────────────

    fn quota_body() -> serde_json::Value {
        serde_json::json!({ "data": { "limits": [
            { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 42.0, "nextResetTime": 1_770_648_402_389i64 },
            { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 71.5, "nextResetTime": 1_770_948_402_389i64 },
            { "type": "TIME_LIMIT", "unit": 5, "number": 1, "currentValue": 120, "usage": 3000 }
        ]}})
    }

    #[test]
    fn map_quota_classifies_windows_by_their_reported_length() {
        let quota = map_quota(&quota_body()).expect("quota");
        assert_eq!(quota.windows.len(), 2);
        // unit 3 × 5 = a 5-hour window → Session.
        assert_eq!(quota.windows[0].label, "Session");
        assert_eq!(quota.windows[0].used_percent, 42.0);
        assert_eq!(quota.windows[0].window_seconds, Some(5 * 60 * 60));
        assert!(quota.windows[0].resets_at.is_some());
        // unit 6 × 1 = a one-week window → Weekly.
        assert_eq!(quota.windows[1].label, "Weekly");
        assert_eq!(quota.windows[1].window_seconds, Some(7 * 24 * 60 * 60));

        assert_eq!(quota.meters.len(), 1);
        assert_eq!(quota.meters[0].label, "Web searches");
        assert_eq!(quota.meters[0].values[0].number, 120.0);
        assert_eq!(quota.meters[0].values[1].number, 3000.0);
    }

    #[test]
    fn map_quota_tolerates_a_root_level_limits_array() {
        let body = serde_json::json!({ "limits": [
            { "name": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0 }
        ]});
        let quota = map_quota(&body).expect("quota");
        assert_eq!(quota.windows.len(), 1);
        assert_eq!(quota.windows[0].label, "Session");
    }

    #[test]
    fn map_quota_empty_limits_is_a_valid_no_data_state() {
        let body = serde_json::json!({ "data": { "limits": [] }});
        let quota = map_quota(&body).expect("quota");
        assert!(quota.windows.is_empty());
        assert!(quota.meters.is_empty());
    }

    #[test]
    fn map_quota_skips_unknown_units_but_refuses_missing_values() {
        // An unfamiliar unit is skipped, not fatal — the known sibling survives.
        let mixed = serde_json::json!({ "data": { "limits": [
            { "type": "TOKENS_LIMIT", "unit": 99, "number": 1, "percentage": 5.0 },
            { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 8.0 }
        ]}});
        let quota = map_quota(&mixed).expect("quota");
        assert_eq!(quota.windows.len(), 1);
        assert_eq!(quota.windows[0].used_percent, 8.0);

        // A recognized window with no percentage is drift → refuse, don't show 0%.
        let missing = serde_json::json!({ "data": { "limits": [
            { "type": "TOKENS_LIMIT", "unit": 3, "number": 5 }
        ]}});
        assert!(map_quota(&missing).is_none());
        // Likewise a web-search entry missing its allowance.
        let no_limit = serde_json::json!({ "data": { "limits": [
            { "type": "TIME_LIMIT", "currentValue": 10 }
        ]}});
        assert!(map_quota(&no_limit).is_none());
        // No limits array at all, or a non-object `data`.
        assert!(map_quota(&serde_json::json!({ "data": {} })).is_none());
        assert!(map_quota(&serde_json::json!({ "data": 3 })).is_none());
    }

    #[test]
    fn no_coding_plan_needs_both_the_flag_and_the_phrase() {
        let signal =
            serde_json::json!({ "success": false, "code": 500, "msg": "no active coding plan" });
        assert!(is_no_coding_plan(&signal));
        // An unrelated business failure must not be mistaken for it.
        let other = serde_json::json!({ "success": false, "msg": "internal error" });
        assert!(!is_no_coding_plan(&other));
        assert!(!is_no_coding_plan(&serde_json::json!({ "success": true })));
        assert!(!is_no_coding_plan(&quota_body()));
    }

    #[test]
    fn plan_name_reads_the_first_product() {
        let body = serde_json::json!({ "data": [{ "productName": "GLM Coding Max" }] });
        assert_eq!(plan_name(&body).as_deref(), Some("GLM Coding Max"));
        assert!(plan_name(&serde_json::json!({ "data": [] })).is_none());
        assert!(plan_name(&serde_json::json!({ "data": [{ "productName": " " }] })).is_none());
        assert!(plan_name(&serde_json::json!({})).is_none());
    }

    /// A daily cap must not be labelled "Weekly" — and two windows must never
    /// come out sharing one label, which is what collapsing everything ≥ a day
    /// into "Weekly" would do for a plan reporting both.
    #[test]
    fn window_label_names_each_duration_distinctly() {
        assert_eq!(window_label(5.0 * 60.0 * 60.0 * 1000.0), "Session");
        assert_eq!(window_label(DAY_MS), "Daily");
        assert_eq!(window_label(7.0 * DAY_MS), "Weekly");
        assert_eq!(window_label(30.0 * DAY_MS), "Monthly");
        assert_eq!(window_label(3.0 * DAY_MS), "3-day");
    }

    #[test]
    fn map_quota_keeps_a_daily_and_a_weekly_cap_apart() {
        let body = serde_json::json!({ "data": { "limits": [
            { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 10.0 },
            { "type": "TOKENS_LIMIT", "unit": 4, "number": 1, "percentage": 20.0 },
            { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 30.0 }
        ]}});
        let quota = map_quota(&body).expect("quota");
        let labels: Vec<&str> = quota.windows.iter().map(|w| w.label.as_str()).collect();
        assert_eq!(labels, vec!["Session", "Daily", "Weekly"]);
    }

    #[test]
    fn window_millis_maps_every_known_unit() {
        let entry = |unit: i64, number: i64| serde_json::json!({ "unit": unit, "number": number });
        assert_eq!(
            window_millis(&entry(3, 5)),
            Some(5.0 * 60.0 * 60.0 * 1000.0)
        );
        assert_eq!(window_millis(&entry(4, 1)), Some(DAY_MS));
        assert_eq!(window_millis(&entry(6, 1)), Some(7.0 * DAY_MS));
        assert_eq!(window_millis(&entry(5, 1)), Some(30.0 * DAY_MS));
        assert!(window_millis(&entry(99, 1)).is_none());
        assert!(window_millis(&entry(3, 0)).is_none());
        assert!(window_millis(&serde_json::json!({ "number": 1 })).is_none());
    }

    // ── fetch end-to-end via loopback server ─────────────────────────────────

    #[tokio::test]
    async fn fetch_not_logged_in_without_a_key() {
        let _g = lock();
        clear_env();
        // HOME is redirected so the on-disk key candidate can't resolve to a real
        // one on the dev machine.
        let home = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", home.path());
        let snap = fetch("acp:glm").await;
        assert!(!snap.available);
        assert_eq!(snap.engine, "glm");
        assert!(matches!(snap.reason, Some(UsageUnavailable::NotLoggedIn)));
        match previous {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
    }

    #[tokio::test]
    async fn fetch_builds_windows_meter_and_plan() {
        let _g = lock();
        clear_env();
        std::env::set_var("ZAI_API_KEY", "zai-key");
        let url = spawn_loopback(
            "200 OK",
            r#"{"data":{"limits":[{"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":42.0,"nextResetTime":1770648402389},{"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":71.5},{"type":"TIME_LIMIT","currentValue":120,"usage":3000}]}}"#,
        );
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        let plan = spawn_loopback("200 OK", r#"{"data":[{"productName":"GLM Coding Max"}]}"#);
        std::env::set_var("RYU_USAGE_GLM_SUBSCRIPTION_URL", &plan);

        let snap = fetch("acp:glm").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.plan.as_deref(), Some("GLM Coding Max"));
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].label, "Session");
        assert_eq!(snap.windows[1].label, "Weekly");
        assert_eq!(snap.meters[0].label, "Web searches");
        clear_env();
    }

    #[tokio::test]
    async fn fetch_reports_no_plan_for_a_key_without_a_coding_plan() {
        let _g = lock();
        clear_env();
        std::env::set_var("ZAI_API_KEY", "zai-key");
        let url = spawn_loopback(
            "200 OK",
            r#"{"success":false,"code":500,"msg":"You have no active coding plan"}"#,
        );
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        let snap = fetch("acp:glm").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::NoPlan)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_survives_a_failing_plan_lookup() {
        let _g = lock();
        clear_env();
        std::env::set_var("ZAI_API_KEY", "zai-key");
        let url = spawn_loopback(
            "200 OK",
            r#"{"data":{"limits":[{"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":9.0}]}}"#,
        );
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        disable_subscription();
        let snap = fetch("acp:glm").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert!(snap.plan.is_none());
        assert_eq!(snap.windows.len(), 1);
        clear_env();
    }

    #[tokio::test]
    async fn fetch_maps_401_and_429_and_bad_json() {
        let _g = lock();
        clear_env();
        std::env::set_var("ZAI_API_KEY", "zai-key");

        let url = spawn_loopback("403 Forbidden", "{}");
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        assert!(matches!(
            fetch("acp:glm").await.reason,
            Some(UsageUnavailable::TokenExpired)
        ));

        let url = spawn_loopback_with_headers("429 Too Many Requests", "Retry-After: 45\r\n", "{}");
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        let snap = fetch("acp:glm").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::RateLimited)));
        assert_eq!(snap.retry_after_seconds, Some(45));

        let url = spawn_loopback("200 OK", "definitely-not-json");
        std::env::set_var("RYU_USAGE_GLM_URL", &url);
        assert!(matches!(
            fetch("acp:glm").await.reason,
            Some(UsageUnavailable::Error)
        ));
        clear_env();
    }
}
