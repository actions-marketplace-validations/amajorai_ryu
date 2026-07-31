//! Codex subscription usage. Reads the OAuth token the `codex` CLI stores in
//! `auth.json` and calls `GET https://chatgpt.com/backend-api/wham/usage` — the
//! same endpoint Codex's own usage view uses — then maps:
//!
//! - `rate_limit.primary_window` / `secondary_window` into the Session (5h) and
//!   Weekly windows. They are classified by each window's own
//!   `limit_window_seconds` rather than by which slot it arrived in: Codex can
//!   temporarily drop one limit and move the remaining *weekly* window into the
//!   `primary_window` slot, which the naive slot mapping would have mislabeled
//!   "Session". The historical slot order stays as the fallback for payloads
//!   that report no recognizable duration.
//! - `additional_rate_limits` → the Spark / Spark Weekly model limits (the
//!   GPT-5.3-Codex-Spark pair), which reuse the same window shape. Accounts
//!   without the limit simply carry no entry.
//! - `rate_limit_reset_credits` → the **banked on-demand rate-limit resets**,
//!   reported as a count. The count alone comes with the usage body; each
//!   credit's *own* expiry date needs the dedicated
//!   `…/wham/rate-limit-reset-credits` endpoint, which we call best-effort and
//!   fall back from to the embedded count.
//! - `credits` → the flex-credit balance, surfaced as both dollars and a credit
//!   count (1 credit = 4¢, the rate the Codex CLI itself prices them at).
//!
//! We deliberately do NOT implement the sibling
//! `…/rate-limit-reset-credits/consume` call that spends a banked reset:
//! claiming one is irreversible, and this crate is read-only by construction.
//!
//! Endpoint + field names were reconstructed from the openusage reference
//! implementation; verify against one live response before trusting blindly.

use std::path::PathBuf;

use serde::Deserialize;

use super::{
    clamp_percent, epoch_secs_to_rfc3339, http_client, jwt_exp_unix, read_file, reason_for_status,
    retry_after_seconds, timestamp_to_rfc3339, title_case, UsageMeter, UsageSnapshot,
    UsageUnavailable, UsageValue, UsageValueKind, UsageWindow,
};

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

/// The usage endpoint to call. Production always uses [`USAGE_URL`]; the
/// `#[cfg(test)]` variant lets a hermetic loopback server stand in via
/// `RYU_USAGE_CODEX_URL` so the end-to-end `fetch` path can be exercised without
/// the real vendor. Compiled out of release builds entirely.
#[cfg(not(test))]
fn usage_url() -> String {
    USAGE_URL.to_string()
}
#[cfg(test)]
fn usage_url() -> String {
    std::env::var("RYU_USAGE_CODEX_URL").unwrap_or_else(|_| USAGE_URL.to_string())
}

/// The dedicated banked-reset-credits endpoint — the only source that carries a
/// per-credit expiry list. Same `#[cfg(test)]` override seam as [`usage_url`].
#[cfg(not(test))]
fn reset_credits_url() -> String {
    RESET_CREDITS_URL.to_string()
}
#[cfg(test)]
fn reset_credits_url() -> String {
    std::env::var("RYU_USAGE_CODEX_RESETS_URL").unwrap_or_else(|_| RESET_CREDITS_URL.to_string())
}

/// Refresh the access token within this slack of its JWT `exp` (same window the
/// `codex` CLI uses) — so we skip a call that's about to 401.
const EXPIRY_SLACK_SECS: i64 = 5 * 60;
/// The 5-hour rolling window, in seconds — the duration that identifies a
/// `*_window` as the Session meter regardless of which slot it arrived in.
const SESSION_WINDOW_SECS: i64 = 5 * 60 * 60;
/// The 7-day window, in seconds — likewise for the Weekly meter.
const WEEKLY_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;
/// One Codex flex credit is worth 4¢ (the `CREDIT_USD_RATE` the Codex CLI and
/// its plugin price them at), so the balance can read as dollars too.
const CREDIT_USD_RATE: f64 = 0.04;

#[derive(Debug, Deserialize)]
struct AuthFile {
    tokens: Option<Tokens>,
    #[serde(rename = "OPENAI_API_KEY")]
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Tokens {
    #[serde(rename = "access_token")]
    access_token: Option<String>,
    #[serde(rename = "account_id")]
    account_id: Option<String>,
}

/// Candidate `auth.json` locations, in priority order: the `CODEX_HOME` override
/// the CLI honours, then the two default homes, then Ryu's isolated copy (used
/// when the user only ever logged in through Ryu's gateway-passthrough path).
fn auth_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(custom) = std::env::var("CODEX_HOME") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            paths.push(PathBuf::from(trimmed).join("auth.json"));
        }
    }
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".config").join("codex").join("auth.json"));
        paths.push(home.join(".codex").join("auth.json"));
    }
    // Ryu's isolated copy (used when the user only ever logged in through Ryu's
    // gateway-passthrough path). Its path is a kernel data-dir concept, so it
    // arrives through the host seam; absent host (unit test) → skip the candidate.
    if let Some(host) = super::host() {
        paths.push(host.ryu_codex_home().join("auth.json"));
    }
    paths
}

fn load_auth() -> Option<AuthFile> {
    for path in auth_paths() {
        if let Some(text) = read_file(&path) {
            if let Ok(auth) = serde_json::from_str::<AuthFile>(&text) {
                let has_token = auth
                    .tokens
                    .as_ref()
                    .and_then(|t| t.access_token.as_ref())
                    .is_some_and(|t| !t.is_empty());
                let has_key = auth.api_key.as_ref().is_some_and(|k| !k.is_empty());
                if has_token || has_key {
                    return Some(auth);
                }
            }
        }
    }
    None
}

pub(super) async fn fetch(agent_id: &str) -> UsageSnapshot {
    let unavailable =
        |reason: UsageUnavailable| UsageSnapshot::unavailable(agent_id, "codex", reason);

    let Some(auth) = load_auth() else {
        return unavailable(UsageUnavailable::NotLoggedIn);
    };

    // Subscription usage needs the OAuth access token. An API-key-only login has
    // no plan window to report → hide the bar.
    let Some(tokens) = auth.tokens else {
        return unavailable(UsageUnavailable::Unsupported);
    };
    let Some(access_token) = tokens.access_token.filter(|t| !t.is_empty()) else {
        return unavailable(UsageUnavailable::Unsupported);
    };

    // Local freshness check — NEVER refresh (single-use refresh tokens).
    if let Some(exp) = jwt_exp_unix(&access_token) {
        let now = chrono::Utc::now().timestamp();
        if exp - now <= EXPIRY_SLACK_SECS {
            return unavailable(UsageUnavailable::TokenExpired);
        }
    }

    let token = access_token.trim();
    let account_id = tokens.account_id.as_deref().filter(|a| !a.is_empty());

    let resp = match get(&usage_url(), token, account_id, false).await {
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
    // Percentages can also ride in response headers, so read them off before the
    // body is consumed — they fill a window whose own `used_percent` is absent.
    let header_percents = (
        header_number(resp.headers(), "x-codex-primary-used-percent"),
        header_number(resp.headers(), "x-codex-secondary-used-percent"),
    );
    let header_credits = header_number(resp.headers(), "x-codex-credits-balance");
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return unavailable(UsageUnavailable::Error);
    };

    // The dedicated banked-reset endpoint is the ONLY source of each credit's own
    // expiry date, but it is strictly best-effort: a failure here must never cost
    // us the windows we already have, so we fall back to the count embedded in
    // the usage body (which carries no expiries).
    let reset_credits_body = match get(&reset_credits_url(), token, account_id, true).await {
        Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
        _ => None,
    };

    let now = chrono::Utc::now();
    let mut snapshot = UsageSnapshot::available(
        agent_id,
        "codex",
        body.get("plan_type").and_then(format_plan),
    );

    snapshot.windows = classified_windows(
        body.get("rate_limit"),
        ("Session", "Weekly"),
        header_percents,
        now,
    );
    // The Spark model limits (GPT-5.3-Codex-Spark) reuse the same window shape
    // inside `additional_rate_limits`, so they classify identically.
    snapshot
        .windows
        .extend(spark_windows(body.get("additional_rate_limits"), now));

    if let Some(resets) = reset_credits(&body, reset_credits_body.as_ref()) {
        snapshot.meters.push(
            UsageMeter::new(
                "Rate limit resets",
                vec![UsageValue::new(
                    resets.count,
                    UsageValueKind::Count,
                    Some("available"),
                )],
            )
            .with_expiries(resets.expiries),
        );
    }
    if let Some(balance) = credits_balance(&body, header_credits) {
        snapshot
            .meters
            .push(UsageMeter::new("Credits", credit_values(balance)));
    }

    snapshot
}

/// One GET against a Codex backend endpoint. `codex_client_headers` adds the two
/// headers the reset-credits endpoint expects from the Codex desktop client (the
/// plain usage endpoint doesn't need them).
async fn get(
    url: &str,
    access_token: &str,
    account_id: Option<&str>,
    codex_client_headers: bool,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut req = http_client()
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "Ryu");
    if codex_client_headers {
        req = req
            .header("OpenAI-Beta", "codex-1")
            .header("originator", "Codex Desktop");
    }
    if let Some(account_id) = account_id {
        req = req.header("ChatGPT-Account-Id", account_id);
    }
    req.send().await
}

/// A numeric response header, or `None` when absent/unparseable.
fn header_number(headers: &reqwest::header::HeaderMap, name: &str) -> Option<f64> {
    headers
        .get(name)?
        .to_str()
        .ok()?
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
}

/// Which meter a rate-limit window belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowKind {
    Session,
    Weekly,
}

/// A `*_window` object paired with the percentage to use for it and the meter it
/// would land on if its duration is unrecognizable.
struct WindowCandidate<'a> {
    window: Option<&'a serde_json::Value>,
    used_percent: Option<f64>,
    fallback_kind: WindowKind,
}

/// The Session + Weekly windows, classified by duration.
///
/// Codex normally returns the 5-hour window as `primary_window` and the weekly
/// window as `secondary_window`, but it can move a temporarily sole weekly limit
/// into the primary slot. So we classify on each window's explicit
/// `limit_window_seconds` when present and keep the historical slot mapping only
/// as the compatibility fallback.
fn classified_windows(
    rate_limit: Option<&serde_json::Value>,
    labels: (&str, &str),
    header_percents: (Option<f64>, Option<f64>),
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<UsageWindow> {
    let candidates: Vec<WindowCandidate> = [
        (
            rate_limit.and_then(|rl| rl.get("primary_window")),
            header_percents.0,
            WindowKind::Session,
        ),
        (
            rate_limit.and_then(|rl| rl.get("secondary_window")),
            header_percents.1,
            WindowKind::Weekly,
        ),
    ]
    .into_iter()
    .filter_map(|(window, header_percent, fallback_kind)| {
        // A header percentage alone is enough to build a meter, so a slot that
        // is entirely absent still counts as a candidate when its header is set.
        if window.is_none() && header_percent.is_none() {
            return None;
        }
        let used_percent = window
            .and_then(|w| w.get("used_percent"))
            .and_then(serde_json::Value::as_f64)
            .or(header_percent);
        Some(WindowCandidate {
            window,
            used_percent,
            fallback_kind,
        })
    })
    .collect();

    [
        (WindowKind::Session, labels.0),
        (WindowKind::Weekly, labels.1),
    ]
    .into_iter()
    .filter_map(|(kind, label)| classified_window(kind, label, &candidates, now))
    .collect()
}

/// The one candidate that belongs on `kind`'s meter: an exact duration match
/// first, then a candidate whose duration is unrecognizable but whose slot
/// historically meant this meter.
fn classified_window(
    kind: WindowKind,
    label: &str,
    candidates: &[WindowCandidate],
    now: chrono::DateTime<chrono::Utc>,
) -> Option<UsageWindow> {
    let exact = candidates
        .iter()
        .find(|candidate| exact_kind(candidate.window) == Some(kind));
    let fallback = candidates.iter().find(|candidate| {
        exact_kind(candidate.window).is_none() && candidate.fallback_kind == kind
    });
    let candidate = exact.or(fallback)?;
    let used_percent = candidate.used_percent?;
    Some(UsageWindow {
        label: label.to_string(),
        used_percent: clamp_percent(used_percent),
        resets_at: reset_at(candidate.window, now),
        window_seconds: window_seconds(candidate.window),
        // Account-wide by default. The Spark pair reuses this builder and stamps
        // its model on afterwards (see `spark_windows`), which keeps the model
        // out of the shared Session/Weekly path entirely.
        model: None,
    })
}

/// The meter a window's reported duration identifies, or `None` when it reports
/// no duration (or an unfamiliar one — a future window length must not silently
/// masquerade as Session or Weekly).
fn exact_kind(window: Option<&serde_json::Value>) -> Option<WindowKind> {
    match window_seconds(window)? {
        SESSION_WINDOW_SECS => Some(WindowKind::Session),
        WEEKLY_WINDOW_SECS => Some(WindowKind::Weekly),
        _ => None,
    }
}

/// A window's own `limit_window_seconds`, when reported.
fn window_seconds(window: Option<&serde_json::Value>) -> Option<i64> {
    window?
        .get("limit_window_seconds")
        .and_then(serde_json::Value::as_f64)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .map(|seconds| seconds as i64)
}

/// When a window resets, RFC3339. `reset_at` is an absolute epoch-seconds
/// timestamp; `reset_after_seconds` is a relative fallback added to `now`.
fn reset_at(
    window: Option<&serde_json::Value>,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<String> {
    let window = window?;
    window
        .get("reset_at")
        .and_then(serde_json::Value::as_i64)
        .and_then(epoch_secs_to_rfc3339)
        .or_else(|| {
            let seconds = window
                .get("reset_after_seconds")
                .and_then(serde_json::Value::as_i64)?;
            Some((now + chrono::Duration::seconds(seconds)).to_rfc3339())
        })
}

/// The Spark (GPT-5.3-Codex-Spark) model limits from `additional_rate_limits`.
/// Each array entry is a named limit whose `rate_limit` reuses the primary /
/// secondary window shape, so parsing mirrors the core Session/Weekly path
/// exactly. Only the Spark entry is surfaced; other model limits in that array
/// aren't shown. An empty result is the common case (accounts without the limit).
fn spark_windows(
    additional: Option<&serde_json::Value>,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<UsageWindow> {
    let Some(entries) = additional.and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let Some(spark) = entries.iter().find(|entry| is_spark_entry(entry)) else {
        return Vec::new();
    };
    // The entry names the model it limits ("GPT-5.3-Codex-Spark"); carry that so a
    // client can attach these two windows to that model's row. Fall back to the
    // meter label when the entry names it in neither field — better a coarse model
    // name than losing the scoping.
    let model = ["limit_name", "metered_feature"]
        .iter()
        .filter_map(|key| spark.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|name| !name.is_empty())
        .unwrap_or("Spark")
        .to_string();
    classified_windows(
        spark.get("rate_limit"),
        ("Spark", "Spark weekly"),
        (None, None),
        now,
    )
    .into_iter()
    .map(|window| UsageWindow {
        model: Some(model.clone()),
        ..window
    })
    .collect()
}

/// True when an `additional_rate_limits` entry is the Spark limit — matched on
/// either `limit_name` ("GPT-5.3-Codex-Spark") or `metered_feature`,
/// case-insensitively, so a wording change on either field still resolves it.
fn is_spark_entry(entry: &serde_json::Value) -> bool {
    ["limit_name", "metered_feature"]
        .iter()
        .filter_map(|key| entry.get(*key).and_then(serde_json::Value::as_str))
        .any(|value| value.to_ascii_lowercase().contains("spark"))
}

/// The banked on-demand rate-limit resets: how many are available, plus each
/// still-available credit's own expiry (soonest-first).
struct ResetCredits {
    count: f64,
    expiries: Vec<String>,
}

/// Read the banked resets, preferring the dedicated endpoint's payload (the only
/// source that carries the per-credit expiry list) and falling back to the usage
/// body's embedded `rate_limit_reset_credits` object (count only).
///
/// The dedicated body is only preferred when it actually carries a *numeric*
/// `available_count`: a JSON `null` is still a present field, so a bare
/// presence check would select an unusable payload and drop the row entirely
/// instead of falling back to the count we do have.
fn reset_credits(
    body: &serde_json::Value,
    dedicated: Option<&serde_json::Value>,
) -> Option<ResetCredits> {
    let source = dedicated
        .filter(|value| available_count(value).is_some())
        .or_else(|| body.get("rate_limit_reset_credits"))?;
    let count = available_count(source)?;
    Some(ResetCredits {
        count: count.floor(),
        expiries: available_expiries(source.get("credits")),
    })
}

/// A non-negative `available_count`, or `None` when missing/null/non-numeric.
fn available_count(source: &serde_json::Value) -> Option<f64> {
    source
        .get("available_count")
        .and_then(serde_json::Value::as_f64)
        .filter(|count| count.is_finite() && *count >= 0.0)
}

/// Every still-available credit's `expires_at`, soonest-first.
///
/// `status` is optional upstream, so a credit is kept when it's explicitly
/// `"available"` *or* carries no status at all — only an explicitly non-available
/// state (`"consumed"` / `"expired"`) is dropped. Filtering hard on
/// `== "available"` would blank the whole expiry list for responses that omit
/// status even though `available_count` reported credits.
fn available_expiries(credits: Option<&serde_json::Value>) -> Vec<String> {
    let Some(credits) = credits.and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let mut expiries: Vec<String> = credits
        .iter()
        .filter(|credit| {
            credit
                .get("status")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|status| status == "available")
        })
        .filter_map(|credit| timestamp_to_rfc3339(credit.get("expires_at")))
        .collect();
    // RFC3339 in a fixed offset sorts lexicographically in time order, and every
    // value here came out of `timestamp_to_rfc3339` (always UTC), so a plain sort
    // is a chronological sort.
    expiries.sort();
    expiries
}

/// The flex-credit balance: `credits.balance`, an explicit
/// `credits.has_credits: false` (a real, measured zero), or the
/// `x-codex-credits-balance` header.
fn credits_balance(body: &serde_json::Value, header_balance: Option<f64>) -> Option<f64> {
    if let Some(credits) = body.get("credits") {
        if let Some(balance) = credits
            .get("balance")
            .and_then(serde_json::Value::as_f64)
            .filter(|balance| balance.is_finite())
        {
            return Some(balance);
        }
        if credits
            .get("has_credits")
            .and_then(serde_json::Value::as_bool)
            == Some(false)
        {
            return Some(0.0);
        }
    }
    header_balance
}

/// The balance as both figures the Codex CLI shows: the floored credit count and
/// its dollar value. The count is floored *before* pricing so our dollar figure
/// agrees with Codex's own, which keeps the two mutually consistent. A negative
/// balance clamps to zero, so an exhausted balance reads a real "$0.00 · 0
/// credits" rather than nothing at all.
fn credit_values(balance: f64) -> Vec<UsageValue> {
    let credits = balance.floor().max(0.0);
    vec![
        UsageValue::new(credits * CREDIT_USD_RATE, UsageValueKind::Dollars, None),
        UsageValue::new(credits, UsageValueKind::Count, Some("credits")),
    ]
}

/// `"plus"` → `"Plus"`, and the two plan names Codex reports opaquely:
/// `"prolite"` is the 5× Pro tier and `"pro"` the 20× one, which is what the
/// user actually recognizes.
fn format_plan(value: &serde_json::Value) -> Option<String> {
    let raw = value.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    match raw.to_ascii_lowercase().as_str() {
        "prolite" => Some("Pro 5x".to_string()),
        "pro" => Some("Pro 20x".to_string()),
        _ => Some(title_case(raw, &['_'])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{spawn_loopback, spawn_loopback_with_headers};

    // CODEX_HOME + RYU_USAGE_CODEX_URL are process-global; serialize env-touching
    // tests. A crafted auth.json under CODEX_HOME is the FIRST auth candidate, so
    // it deterministically wins over any real ~/.codex on the dev machine.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn write_auth(dir: &std::path::Path, body: &str) {
        std::env::set_var("CODEX_HOME", dir);
        std::fs::write(dir.join("auth.json"), body).unwrap();
    }

    fn clear_env() {
        std::env::remove_var("CODEX_HOME");
        std::env::remove_var("RYU_USAGE_CODEX_URL");
        std::env::remove_var("RYU_USAGE_CODEX_RESETS_URL");
    }

    fn jwt_with_exp(exp: i64) -> String {
        use base64::Engine as _;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp}}}"#).as_bytes());
        format!("h.{payload}.s")
    }

    /// Point the reset-credits fetch at a closed port so it fails fast and the
    /// embedded-count fallback is what a test observes.
    fn disable_reset_endpoint() {
        std::env::set_var("RYU_USAGE_CODEX_RESETS_URL", "http://127.0.0.1:1/resets");
    }

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc::now()
    }

    // ── pure helpers ─────────────────────────────────────────────────────────

    #[test]
    fn format_plan_maps_opaque_codex_tiers() {
        let plan = |raw: &str| format_plan(&serde_json::json!(raw));
        assert_eq!(plan("prolite").as_deref(), Some("Pro 5x"));
        assert_eq!(plan("pro").as_deref(), Some("Pro 20x"));
        assert_eq!(plan("PRO").as_deref(), Some("Pro 20x"));
        assert_eq!(plan("plus").as_deref(), Some("Plus"));
        assert_eq!(plan(" team ").as_deref(), Some("Team"));
        assert_eq!(plan("business_plus").as_deref(), Some("Business Plus"));
        assert!(plan("").is_none());
        assert!(format_plan(&serde_json::json!(7)).is_none());
    }

    #[test]
    fn window_uses_absolute_reset_at() {
        let rate_limit = serde_json::json!({
            "primary_window": { "used_percent": 30.0, "reset_at": 1_800_000_000i64 }
        });
        let windows = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now(),
        );
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Session");
        assert_eq!(windows[0].used_percent, 30.0);
        assert_eq!(
            windows[0].resets_at.as_deref(),
            epoch_secs_to_rfc3339(1_800_000_000).as_deref()
        );
    }

    #[test]
    fn window_falls_back_to_relative_reset_after_seconds() {
        let at = now();
        let rate_limit = serde_json::json!({
            "secondary_window": { "used_percent": 12.0, "reset_after_seconds": 3600i64 }
        });
        let windows =
            classified_windows(Some(&rate_limit), ("Session", "Weekly"), (None, None), at);
        assert_eq!(windows[0].label, "Weekly");
        assert_eq!(
            windows[0].resets_at.as_deref(),
            Some((at + chrono::Duration::seconds(3600)).to_rfc3339().as_str())
        );
    }

    #[test]
    fn window_without_used_percent_or_rate_limit_is_skipped() {
        assert!(classified_windows(None, ("Session", "Weekly"), (None, None), now()).is_empty());
        let rate_limit = serde_json::json!({ "primary_window": { "reset_at": 1_800_000_000i64 } });
        assert!(classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now()
        )
        .is_empty());
    }

    /// The classification fix: a *weekly* window sitting in the primary slot must
    /// read "Weekly", not "Session".
    #[test]
    fn window_classified_by_duration_not_slot() {
        let rate_limit = serde_json::json!({
            "primary_window": {
                "used_percent": 44.0,
                "limit_window_seconds": WEEKLY_WINDOW_SECS,
                "reset_at": 1_800_000_000i64
            }
        });
        let windows = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now(),
        );
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Weekly");
        assert_eq!(windows[0].used_percent, 44.0);
        assert_eq!(windows[0].window_seconds, Some(WEEKLY_WINDOW_SECS));
    }

    #[test]
    fn window_unrecognized_duration_keeps_slot_fallback() {
        let rate_limit = serde_json::json!({
            "primary_window": { "used_percent": 5.0, "limit_window_seconds": 999i64 }
        });
        let windows = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now(),
        );
        assert_eq!(windows[0].label, "Session");
        assert_eq!(windows[0].window_seconds, Some(999));
    }

    #[test]
    fn window_percent_comes_from_header_when_body_omits_it() {
        let rate_limit = serde_json::json!({ "primary_window": { "reset_at": 1_800_000_000i64 } });
        let windows = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (Some(66.0), None),
            now(),
        );
        assert_eq!(windows[0].used_percent, 66.0);
    }

    #[test]
    fn window_percent_clamps_out_of_range() {
        let rate_limit = serde_json::json!({ "primary_window": { "used_percent": 140.0 } });
        let windows = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now(),
        );
        assert_eq!(windows[0].used_percent, 100.0);
    }

    // ── Spark ────────────────────────────────────────────────────────────────

    #[test]
    fn spark_windows_read_the_named_entry() {
        let additional = serde_json::json!([
            { "limit_name": "some-other-model", "rate_limit": { "primary_window": { "used_percent": 1.0 } } },
            { "limit_name": "GPT-5.3-Codex-Spark", "rate_limit": {
                "primary_window": { "used_percent": 20.0, "limit_window_seconds": SESSION_WINDOW_SECS },
                "secondary_window": { "used_percent": 40.0, "limit_window_seconds": WEEKLY_WINDOW_SECS }
            } }
        ]);
        let windows = spark_windows(Some(&additional), now());
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].label, "Spark");
        assert_eq!(windows[0].used_percent, 20.0);
        assert_eq!(windows[1].label, "Spark weekly");
        assert_eq!(windows[1].used_percent, 40.0);
    }

    /// The Spark pair must be attributable to its model; Session/Weekly must not
    /// be. Without that distinction a client can only guess from the label, and
    /// would hang an account-wide quota off whichever model shared a word.
    #[test]
    fn spark_windows_carry_their_model_and_core_windows_do_not() {
        let additional = serde_json::json!([
            { "limit_name": "GPT-5.3-Codex-Spark", "rate_limit": {
                "primary_window": { "used_percent": 20.0, "limit_window_seconds": SESSION_WINDOW_SECS }
            } }
        ]);
        let spark = spark_windows(Some(&additional), now());
        assert_eq!(spark[0].model.as_deref(), Some("GPT-5.3-Codex-Spark"));

        let rate_limit = serde_json::json!({ "primary_window": { "used_percent": 5.0 } });
        let core = classified_windows(
            Some(&rate_limit),
            ("Session", "Weekly"),
            (None, None),
            now(),
        );
        assert!(core[0].model.is_none(), "Session is account-wide");
    }

    #[test]
    fn spark_windows_fall_back_to_the_meter_name_without_an_entry_name() {
        let additional = serde_json::json!([
            { "metered_feature": "   ", "limit_name": "spark", "rate_limit": {
                "primary_window": { "used_percent": 1.0 }
            } }
        ]);
        let spark = spark_windows(Some(&additional), now());
        assert_eq!(spark[0].model.as_deref(), Some("spark"));
    }

    #[test]
    fn spark_windows_matches_metered_feature_and_skips_non_objects() {
        let additional = serde_json::json!([
            "garbage",
            { "metered_feature": "codex_SPARK_tokens", "rate_limit": { "primary_window": { "used_percent": 7.0 } } }
        ]);
        let windows = spark_windows(Some(&additional), now());
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Spark");
    }

    #[test]
    fn spark_windows_empty_without_spark_entry() {
        assert!(spark_windows(None, now()).is_empty());
        let additional = serde_json::json!([{ "limit_name": "other" }]);
        assert!(spark_windows(Some(&additional), now()).is_empty());
    }

    // ── banked rate-limit resets ─────────────────────────────────────────────

    #[test]
    fn reset_credits_prefers_dedicated_payload_with_per_credit_expiries() {
        let body = serde_json::json!({ "rate_limit_reset_credits": { "available_count": 1 } });
        let dedicated = serde_json::json!({
            "available_count": 2,
            "credits": [
                { "status": "available", "expires_at": "2026-08-02T17:30:00Z" },
                { "status": "available", "expires_at": "2026-07-31T09:00:00Z" },
                { "status": "consumed", "expires_at": "2026-07-30T09:00:00Z" }
            ]
        });
        let resets = reset_credits(&body, Some(&dedicated)).expect("resets read");
        assert_eq!(resets.count, 2.0);
        // Soonest-first, and the consumed credit is dropped.
        assert_eq!(resets.expiries.len(), 2);
        assert!(resets.expiries[0].starts_with("2026-07-31"));
        assert!(resets.expiries[1].starts_with("2026-08-02"));
    }

    #[test]
    fn reset_credits_keeps_credits_without_a_status() {
        let dedicated = serde_json::json!({
            "available_count": 1,
            "credits": [{ "expires_at": 1_800_000_000i64 }]
        });
        let resets = reset_credits(&serde_json::json!({}), Some(&dedicated)).expect("resets read");
        assert_eq!(resets.expiries.len(), 1);
    }

    #[test]
    fn reset_credits_falls_back_to_embedded_count_when_dedicated_count_is_null() {
        let body = serde_json::json!({ "rate_limit_reset_credits": { "available_count": 3 } });
        let dedicated = serde_json::json!({ "available_count": serde_json::Value::Null });
        let resets = reset_credits(&body, Some(&dedicated)).expect("resets read");
        assert_eq!(resets.count, 3.0);
        assert!(resets.expiries.is_empty());
    }

    #[test]
    fn reset_credits_reports_a_real_zero_but_skips_a_missing_count() {
        let zero = serde_json::json!({ "rate_limit_reset_credits": { "available_count": 0 } });
        assert_eq!(reset_credits(&zero, None).expect("zero read").count, 0.0);
        assert!(reset_credits(&serde_json::json!({}), None).is_none());
        let malformed =
            serde_json::json!({ "rate_limit_reset_credits": { "available_count": "two" } });
        assert!(reset_credits(&malformed, None).is_none());
    }

    // ── flex credits ─────────────────────────────────────────────────────────

    #[test]
    fn credits_balance_reads_body_then_header() {
        let body = serde_json::json!({ "credits": { "balance": 821.7 } });
        assert_eq!(credits_balance(&body, None), Some(821.7));
        let exhausted = serde_json::json!({ "credits": { "has_credits": false } });
        assert_eq!(credits_balance(&exhausted, None), Some(0.0));
        assert_eq!(
            credits_balance(&serde_json::json!({}), Some(12.0)),
            Some(12.0)
        );
        assert!(credits_balance(&serde_json::json!({}), None).is_none());
    }

    #[test]
    fn credit_values_floor_before_pricing_and_clamp_negatives() {
        let values = credit_values(821.7);
        assert_eq!(values[1].number, 821.0);
        // 821 × 4¢ — floored first, so this agrees with Codex's own dollar figure.
        assert!((values[0].number - 32.84).abs() < 1e-9);
        let exhausted = credit_values(-5.0);
        assert_eq!(exhausted[0].number, 0.0);
        assert_eq!(exhausted[1].number, 0.0);
    }

    // ── auth path resolution ─────────────────────────────────────────────────

    #[test]
    fn auth_paths_prioritizes_codex_home() {
        let _g = lock();
        std::env::set_var("CODEX_HOME", "/tmp/xyz-codex");
        let paths = auth_paths();
        assert_eq!(paths[0], PathBuf::from("/tmp/xyz-codex").join("auth.json"));
        std::env::remove_var("CODEX_HOME");
        // Without the override, CODEX_HOME is not the first candidate.
        let paths = auth_paths();
        assert!(paths
            .iter()
            .all(|p| p != &PathBuf::from("/tmp/xyz-codex").join("auth.json")));
    }

    #[test]
    fn auth_paths_ignores_blank_codex_home() {
        let _g = lock();
        std::env::set_var("CODEX_HOME", "   ");
        let paths = auth_paths();
        // Blank override contributes no candidate; the default homes remain.
        assert!(paths.iter().all(|p| !p.starts_with("   ")));
        std::env::remove_var("CODEX_HOME");
    }

    #[test]
    fn load_auth_reads_oauth_token() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(
            dir.path(),
            r#"{"tokens":{"access_token":"tok","account_id":"acc"}}"#,
        );
        let auth = load_auth().expect("auth loaded");
        assert_eq!(
            auth.tokens.and_then(|t| t.access_token).as_deref(),
            Some("tok")
        );
        clear_env();
    }

    #[test]
    fn load_auth_reads_api_key_only_login() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"OPENAI_API_KEY":"sk-live"}"#);
        let auth = load_auth().expect("auth loaded");
        assert_eq!(auth.api_key.as_deref(), Some("sk-live"));
        assert!(auth.tokens.is_none());
        clear_env();
    }

    // ── fetch gates (no network) ─────────────────────────────────────────────

    #[tokio::test]
    async fn fetch_unsupported_for_api_key_only_login() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"OPENAI_API_KEY":"sk-live"}"#);
        let snap = fetch("acp:codex").await;
        assert!(!snap.available);
        assert_eq!(snap.engine, "codex");
        assert!(matches!(snap.reason, Some(UsageUnavailable::Unsupported)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_unsupported_when_access_token_empty() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        // has_key keeps load_auth returning this entry; the empty access_token then
        // trips the Unsupported branch inside fetch.
        write_auth(
            dir.path(),
            r#"{"tokens":{"access_token":""},"OPENAI_API_KEY":"sk"}"#,
        );
        let snap = fetch("acp:codex").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::Unsupported)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_token_expired_for_past_jwt() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        let past = chrono::Utc::now().timestamp() - 3600;
        write_auth(
            dir.path(),
            &format!(
                r#"{{"tokens":{{"access_token":"{}"}}}}"#,
                jwt_with_exp(past)
            ),
        );
        let snap = fetch("acp:codex").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::TokenExpired)));
        clear_env();
    }

    // ── fetch end-to-end via loopback server ─────────────────────────────────

    #[tokio::test]
    async fn fetch_happy_path_builds_windows_meters_and_plan() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        // A non-JWT opaque token => jwt_exp_unix returns None => no expiry gate =>
        // proceeds to the (loopback) network call. account_id exercises the
        // ChatGPT-Account-Id header branch.
        write_auth(
            dir.path(),
            r#"{"tokens":{"access_token":"opaque-token","account_id":"acc-1"}}"#,
        );
        let url = spawn_loopback(
            "200 OK",
            r#"{"plan_type":"prolite","rate_limit":{"primary_window":{"used_percent":30.0,"reset_at":1800000000,"limit_window_seconds":18000},"secondary_window":{"used_percent":12.0,"reset_after_seconds":3600,"limit_window_seconds":604800}},"credits":{"balance":821.7},"rate_limit_reset_credits":{"available_count":1}}"#,
        );
        std::env::set_var("RYU_USAGE_CODEX_URL", &url);
        let resets = spawn_loopback(
            "200 OK",
            r#"{"available_count":2,"credits":[{"status":"available","expires_at":"2026-08-02T17:30:00Z"},{"status":"available","expires_at":"2026-07-31T09:00:00Z"}]}"#,
        );
        std::env::set_var("RYU_USAGE_CODEX_RESETS_URL", &resets);

        let snap = fetch("acp:codex").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.engine, "codex");
        assert_eq!(snap.plan.as_deref(), Some("Pro 5x"));
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].label, "Session");
        assert_eq!(snap.windows[0].used_percent, 30.0);
        assert_eq!(snap.windows[0].window_seconds, Some(SESSION_WINDOW_SECS));
        assert!(snap.windows[0].resets_at.is_some());
        assert_eq!(snap.windows[1].label, "Weekly");
        assert!(snap.windows[1].resets_at.is_some());

        // The dedicated endpoint's count + per-credit expiries win over the
        // embedded count of 1.
        let banked = snap
            .meters
            .iter()
            .find(|m| m.label == "Rate limit resets")
            .expect("banked resets meter");
        assert_eq!(banked.values[0].number, 2.0);
        assert_eq!(banked.expires_at.len(), 2);
        assert!(banked.expires_at[0].starts_with("2026-07-31"));

        let credits = snap
            .meters
            .iter()
            .find(|m| m.label == "Credits")
            .expect("credits meter");
        assert_eq!(credits.values[1].number, 821.0);
        clear_env();
    }

    #[tokio::test]
    async fn fetch_falls_back_to_embedded_reset_count_when_dedicated_call_fails() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"tokens":{"access_token":"opaque"}}"#);
        let url = spawn_loopback(
            "200 OK",
            r#"{"rate_limit":{"primary_window":{"used_percent":10.0}},"rate_limit_reset_credits":{"available_count":3}}"#,
        );
        std::env::set_var("RYU_USAGE_CODEX_URL", &url);
        disable_reset_endpoint();

        let snap = fetch("acp:codex").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        let banked = snap
            .meters
            .iter()
            .find(|m| m.label == "Rate limit resets")
            .expect("banked resets meter");
        assert_eq!(banked.values[0].number, 3.0);
        // No dedicated payload → no per-credit expiries to show.
        assert!(banked.expires_at.is_empty());
        clear_env();
    }

    #[tokio::test]
    async fn fetch_reads_percent_and_credits_from_headers() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"tokens":{"access_token":"opaque"}}"#);
        let url = spawn_loopback_with_headers(
            "200 OK",
            "x-codex-primary-used-percent: 77\r\nx-codex-credits-balance: 50\r\n",
            r#"{"rate_limit":{"primary_window":{"reset_at":1800000000}}}"#,
        );
        std::env::set_var("RYU_USAGE_CODEX_URL", &url);
        disable_reset_endpoint();

        let snap = fetch("acp:codex").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.windows[0].used_percent, 77.0);
        let credits = snap
            .meters
            .iter()
            .find(|m| m.label == "Credits")
            .expect("credits meter");
        assert_eq!(credits.values[1].number, 50.0);
        clear_env();
    }

    #[tokio::test]
    async fn fetch_maps_429_to_rate_limited_with_retry_after() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"tokens":{"access_token":"opaque"}}"#);
        let url =
            spawn_loopback_with_headers("429 Too Many Requests", "Retry-After: 120\r\n", "{}");
        std::env::set_var("RYU_USAGE_CODEX_URL", &url);
        let snap = fetch("acp:codex").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::RateLimited)));
        assert_eq!(snap.retry_after_seconds, Some(120));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_bad_json_body_is_error() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"tokens":{"access_token":"opaque"}}"#);
        let url = spawn_loopback("200 OK", "definitely-not-json");
        std::env::set_var("RYU_USAGE_CODEX_URL", &url);
        let snap = fetch("acp:codex").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::Error)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_connection_refused_is_error() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"tokens":{"access_token":"opaque"}}"#);
        // Port 1 on loopback refuses immediately — exercises the reqwest send-error
        // arm without any external network.
        std::env::set_var("RYU_USAGE_CODEX_URL", "http://127.0.0.1:1/usage");
        let snap = fetch("acp:codex").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::Error)));
        clear_env();
    }

    /// Route through the public entry point so the `fetch_usage` engine-dispatch
    /// arm for Codex is exercised.
    #[tokio::test]
    async fn fetch_usage_dispatches_to_codex() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        write_auth(dir.path(), r#"{"OPENAI_API_KEY":"sk-live"}"#);
        let snap = crate::fetch_usage("acp:codex").await;
        assert_eq!(snap.engine, "codex");
        assert!(matches!(snap.reason, Some(UsageUnavailable::Unsupported)));
        clear_env();
    }

    #[tokio::test]
    async fn fetch_not_logged_in_when_no_auth_anywhere() {
        let _g = lock();
        // Override HOME so dirs::home_dir() (used for the ~/.config/codex and
        // ~/.codex default candidates) points at an empty temp dir, and CODEX_HOME
        // at another empty temp dir. With no auth.json on any candidate, load_auth
        // returns None => NotLoggedIn — hermetic despite a real ~/.codex existing on
        // the dev machine.
        let home = tempfile::tempdir().unwrap();
        let codex_home = tempfile::tempdir().unwrap();
        let prev_home = std::env::var_os("HOME");
        std::env::set_var("HOME", home.path());
        std::env::set_var("CODEX_HOME", codex_home.path());

        assert!(load_auth().is_none(), "no auth file anywhere => None");
        let snap = fetch("acp:codex").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::NotLoggedIn)));

        match prev_home {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
        clear_env();
    }

    #[test]
    fn auth_structs_are_debug_printable() {
        // Exercises the derived Debug impls on the auth structs.
        let parsed: AuthFile = serde_json::from_str(
            r#"{"tokens":{"access_token":"t","account_id":"a"},"OPENAI_API_KEY":"k"}"#,
        )
        .unwrap();
        assert!(!format!("{parsed:?}").is_empty());
    }
}
