//! BYOK provider **API credit balances** — "how many dollars are left on the key
//! I pasted for this provider".
//!
//! Sibling to the subscription readers: those meter a *plan's* rolling windows
//! for an agent, this reads a *prepaid balance* for a provider. Both end up as
//! [`UsageMeter`] rows, so the desktop renders them with one set of components.
//!
//! Unlike the agent readers this one is handed its credential rather than
//! finding it: the key lives in Core's `models.json` (or the provider's auth env
//! var), which is a kernel concept, so `apps/core`'s route handler resolves it
//! and passes it in. That keeps this crate's ZERO dependency on `apps/core`
//! without growing [`crate::UsageHost`] a credential method — a trait that hands
//! out secrets is a worse seam than a parameter. The key is used for exactly one
//! `Authorization` header and never stored, logged, or echoed into the snapshot.
//!
//! ## Why only three providers
//!
//! Most vendors simply do not expose a balance to the inference key you already
//! hold. Verified against CodexBar's working implementations rather than assumed:
//!
//! - **OpenAI** — no endpoint for an `sk-` key. The `dashboard/billing/credit_grants`
//!   route people reach for needs a browser *session* token, not an API key;
//!   CodexBar still tracks it as an open issue rather than shipping it.
//! - **Anthropic** — usage and cost reports live behind the Admin API and need an
//!   `sk-ant-admin` key, a different credential from the inference key.
//! - **Groq / Mistral** — CodexBar reads both from a signed-in *browser session*
//!   (`console.groq.com`, `admin.mistral.ai`'s tRPC endpoints with Referer/Origin
//!   headers). Harvesting browser cookies is not a posture this crate takes.
//! - **xAI** — needs a separate Management API key plus a team id.
//! - **Gemini / Cerebras / Fireworks / Together / NVIDIA / HuggingFace** — no
//!   documented balance endpoint found.
//! - **MiniMax** — deliberately deferred: regional hosts and four competing
//!   spellings of the balance field make it the one where a misread ships a
//!   confidently wrong dollar figure.
//!
//! An unsupported provider answers [`UsageUnavailable::Unsupported`], which makes
//! the desktop hide the row rather than imply the balance is zero.
//!
//! One overlap to keep straight: `zai` is in Core's provider table with
//! `auth_env: "ZAI_API_KEY"`, and [`crate::glm`] already reads that same variable
//! — for the GLM Coding Plan's *subscription quota*, not a prepaid balance. Z.ai
//! is deliberately absent from [`supports_provider_credits`] so one key never
//! feeds two rows that would look like separate money.

use super::{
    http_client, reason_for_status, retry_after_seconds, UsageMeter, UsageUnavailable, UsageValue,
    UsageValueKind,
};

use serde::Serialize;

/// A provider's prepaid API credit balance. Mirrors [`crate::UsageSnapshot`]'s
/// always-200 shape: refusals carry `available = false` + a `reason` so the
/// desktop never branches on HTTP status.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderCreditsSnapshot {
    /// The provider id this is for (echoed back).
    pub provider_id: String,
    /// Whether `meters` carries a live balance.
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<UsageUnavailable>,
    /// The balance rows. Empty when unavailable.
    pub meters: Vec<UsageMeter>,
    /// Seconds to wait, from a rate-limited vendor's `Retry-After`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<i64>,
}

impl ProviderCreditsSnapshot {
    fn unavailable(provider_id: &str, reason: UsageUnavailable) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            available: false,
            reason: Some(reason),
            meters: Vec::new(),
            retry_after_seconds: None,
        }
    }

    fn available(provider_id: &str, meters: Vec<UsageMeter>) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            available: true,
            reason: None,
            meters,
            retry_after_seconds: None,
        }
    }
}

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/credits";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/user/balance";
/// Moonshot serves two regional hosts with separate accounts; a key issued for
/// one is rejected by the other, so the `.cn` host is tried only after the
/// international one refuses.
const MOONSHOT_URL: &str = "https://api.moonshot.ai/v1/users/me/balance";
const MOONSHOT_CN_URL: &str = "https://api.moonshot.cn/v1/users/me/balance";

/// Test seam: each provider's endpoint, overridable by a hermetic loopback server
/// exactly like the agent readers. Compiled out of release builds.
#[cfg(not(test))]
fn endpoint(default: &str, _var: &str) -> String {
    default.to_string()
}
#[cfg(test)]
fn endpoint(default: &str, var: &str) -> String {
    std::env::var(var).unwrap_or_else(|_| default.to_string())
}

/// Every provider with a readable prepaid balance, in display order.
///
/// The list, not just the predicate, is public because a client has to *offer*
/// these — the settings form for a "provider credit below $X" fallback rule can
/// only list providers whose balance can actually be read, or it produces a rule
/// that silently never fires. Serving the list keeps that form correct when this
/// crate gains a fourth provider, instead of relying on somebody remembering to
/// edit a hand-copied array in the desktop.
pub const PROVIDERS_WITH_CREDITS: &[&str] = &["openrouter", "deepseek", "moonshot"];

/// Whether this provider has a readable API credit balance at all. Lets a client
/// skip polling the ~16 providers that would only ever answer `unsupported` —
/// the picker lists them all, and a badge per row must not mean a request per row.
pub fn supports_provider_credits(provider_id: &str) -> bool {
    let id = provider_id.trim().to_ascii_lowercase();
    PROVIDERS_WITH_CREDITS.contains(&id.as_str())
}

/// Read one provider's remaining API credit. Never errors — refusals ride in the
/// snapshot. `api_key` is used for one `Authorization` header and nothing else.
pub async fn fetch_provider_credits(provider_id: &str, api_key: &str) -> ProviderCreditsSnapshot {
    let id = provider_id.trim().to_ascii_lowercase();
    let key = api_key.trim();
    // Support is decided BEFORE the credential check, so a provider that has no
    // balance endpoint at all reads `unsupported` (hide the row) rather than
    // `not_logged_in` (which would imply pasting a key would make it work).
    if !supports_provider_credits(&id) {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Unsupported);
    }
    if key.is_empty() {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::NotLoggedIn);
    }
    match id.as_str() {
        "openrouter" => openrouter(provider_id, key).await,
        "deepseek" => deepseek(provider_id, key).await,
        "moonshot" => moonshot(provider_id, key).await,
        _ => ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Unsupported),
    }
}

/// One authenticated GET. Returns the parsed body, or the refusal to report.
async fn get_json(
    provider_id: &str,
    url: &str,
    api_key: &str,
) -> Result<serde_json::Value, ProviderCreditsSnapshot> {
    let resp = http_client()
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .header("User-Agent", "Ryu")
        .send()
        .await
        .map_err(|_| ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error))?;
    if !resp.status().is_success() {
        let mut snapshot =
            ProviderCreditsSnapshot::unavailable(provider_id, reason_for_status(resp.status()));
        snapshot.retry_after_seconds = retry_after_seconds(resp.headers());
        return Err(snapshot);
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|_| ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error))
}

/// The balance rows for a provider: what's left, plus — as its OWN row — any
/// granted/voucher money the user didn't pay for.
///
/// Deliberately two meters rather than two values on one. A meter's two same-kind
/// values mean "value against cap" to every renderer (that is what Claude's
/// `spent`/`cap` and Z.ai's `used`/`limit` rows are), so packing a balance and a
/// grant into one row would render "$9.87/$1.23" — read as "9.87 of 1.23 used",
/// the opposite of the truth. A separate row cannot be misread that way.
fn balance_meters(remaining: f64, secondary: Option<(f64, &str)>) -> Vec<UsageMeter> {
    let mut meters = vec![UsageMeter::new(
        "API credit",
        vec![UsageValue::new(
            remaining.max(0.0),
            UsageValueKind::Dollars,
            None,
        )],
    )];
    if let Some((amount, label)) = secondary.filter(|(amount, _)| *amount > 0.0) {
        meters.push(UsageMeter::new(
            label,
            vec![UsageValue::new(amount, UsageValueKind::Dollars, None)],
        ));
    }
    meters
}

/// OpenRouter: `{ data: { total_credits, total_usage } }`, both USD. The balance
/// is the difference — OpenRouter reports lifetime totals, not a remainder.
async fn openrouter(provider_id: &str, api_key: &str) -> ProviderCreditsSnapshot {
    let url = endpoint(OPENROUTER_URL, "RYU_CREDITS_OPENROUTER_URL");
    let body = match get_json(provider_id, &url, api_key).await {
        Ok(body) => body,
        Err(refusal) => return refusal,
    };
    let Some(data) = body.get("data") else {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error);
    };
    let total = number(data.get("total_credits"));
    let used = number(data.get("total_usage"));
    let (Some(total), Some(used)) = (total, used) else {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error);
    };
    ProviderCreditsSnapshot::available(provider_id, balance_meters(total - used, None))
}

/// DeepSeek: `{ is_available, balance_infos: [{ currency, total_balance,
/// granted_balance, topped_up_balance }] }`.
///
/// The amounts arrive as either JSON numbers OR numeric **strings**, so every
/// read goes through [`number`]. `is_available: false` means the account can't
/// serve API calls (a dry or suspended balance) — reported as a real zero rather
/// than hidden, because "you have nothing left" is the answer the user wants.
async fn deepseek(provider_id: &str, api_key: &str) -> ProviderCreditsSnapshot {
    let url = endpoint(DEEPSEEK_URL, "RYU_CREDITS_DEEPSEEK_URL");
    let body = match get_json(provider_id, &url, api_key).await {
        Ok(body) => body,
        Err(refusal) => return refusal,
    };
    // Prefer the USD row when the account carries several currencies; otherwise
    // take the first, so a CNY-only account still reports something.
    let infos = body
        .get("balance_infos")
        .and_then(serde_json::Value::as_array);
    let Some(info) = infos.and_then(|rows| {
        rows.iter()
            .find(|row| {
                row.get("currency")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|c| c.eq_ignore_ascii_case("usd"))
            })
            .or_else(|| rows.first())
    }) else {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error);
    };
    let Some(total) = number(info.get("total_balance")) else {
        return ProviderCreditsSnapshot::unavailable(provider_id, UsageUnavailable::Error);
    };
    let granted = number(info.get("granted_balance")).unwrap_or(0.0);
    ProviderCreditsSnapshot::available(
        provider_id,
        balance_meters(total, Some((granted, "Granted"))),
    )
}

/// Moonshot / Kimi: `{ data: { available_balance, voucher_balance, cash_balance } }`.
///
/// Two regional hosts serve separate accounts, so a key issued on one is rejected
/// by the other. The international host is tried first and the mainland host only
/// after a refusal — never speculatively, so a working key costs one request.
async fn moonshot(provider_id: &str, api_key: &str) -> ProviderCreditsSnapshot {
    let international = endpoint(MOONSHOT_URL, "RYU_CREDITS_MOONSHOT_URL");
    let refusal = match moonshot_at(provider_id, &international, api_key).await {
        Ok(snapshot) => return snapshot,
        Err(refusal) => refusal,
    };
    let china = endpoint(MOONSHOT_CN_URL, "RYU_CREDITS_MOONSHOT_CN_URL");
    match moonshot_at(provider_id, &china, api_key).await {
        Ok(snapshot) => snapshot,
        // Report the FIRST host's refusal: it is the one the user most likely
        // meant, so "token expired" beats the second host's inevitable 401.
        Err(_) => refusal,
    }
}

async fn moonshot_at(
    provider_id: &str,
    url: &str,
    api_key: &str,
) -> Result<ProviderCreditsSnapshot, ProviderCreditsSnapshot> {
    let body = get_json(provider_id, url, api_key).await?;
    let Some(data) = body.get("data") else {
        return Err(ProviderCreditsSnapshot::unavailable(
            provider_id,
            UsageUnavailable::Error,
        ));
    };
    let Some(available) = number(data.get("available_balance")) else {
        return Err(ProviderCreditsSnapshot::unavailable(
            provider_id,
            UsageUnavailable::Error,
        ));
    };
    let voucher = number(data.get("voucher_balance")).unwrap_or(0.0);
    Ok(ProviderCreditsSnapshot::available(
        provider_id,
        balance_meters(available, Some((voucher, "Voucher"))),
    ))
}

/// A finite number from a JSON number OR a numeric string. DeepSeek ships the
/// balance both ways depending on the field, so no caller may assume one shape.
fn number(value: Option<&serde_json::Value>) -> Option<f64> {
    let value = value?;
    if let Some(number) = value.as_f64() {
        return number.is_finite().then_some(number);
    }
    let parsed = value.as_str()?.trim().parse::<f64>().ok()?;
    parsed.is_finite().then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{spawn_loopback, spawn_loopback_with_headers};

    // The URL overrides are process-global; serialize env-touching tests.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn clear_env() {
        for var in [
            "RYU_CREDITS_OPENROUTER_URL",
            "RYU_CREDITS_DEEPSEEK_URL",
            "RYU_CREDITS_MOONSHOT_URL",
            "RYU_CREDITS_MOONSHOT_CN_URL",
        ] {
            std::env::remove_var(var);
        }
    }

    // ── pure helpers ─────────────────────────────────────────────────────────

    #[test]
    fn supports_only_the_providers_with_a_readable_balance() {
        for id in [
            "openrouter",
            "deepseek",
            "moonshot",
            "OpenRouter",
            " deepseek ",
        ] {
            assert!(supports_provider_credits(id), "{id}");
        }
        // The vendors that expose nothing to an inference key must stay out, or a
        // client would poll them on every picker open for a guaranteed refusal.
        for id in [
            "openai",
            "anthropic",
            "gemini",
            "groq",
            "mistral",
            "xai",
            "cerebras",
            "fireworks",
            "together",
            "nvidia",
            "minimax",
            "huggingface",
            "",
        ] {
            assert!(!supports_provider_credits(id), "{id}");
        }
    }

    #[test]
    fn number_reads_json_numbers_and_numeric_strings() {
        assert_eq!(number(Some(&serde_json::json!(12.5))), Some(12.5));
        // DeepSeek ships the balance as a string on some fields.
        assert_eq!(number(Some(&serde_json::json!("12.5"))), Some(12.5));
        assert_eq!(number(Some(&serde_json::json!(" 3 "))), Some(3.0));
        assert!(number(Some(&serde_json::json!("abc"))).is_none());
        assert!(number(Some(&serde_json::Value::Null)).is_none());
        assert!(number(None).is_none());
    }

    #[test]
    fn balance_meters_clamp_and_keep_the_grant_on_its_own_row() {
        let meters = balance_meters(-4.0, Some((0.0, "Granted")));
        assert_eq!(meters.len(), 1, "a zero secondary is not a row");
        assert_eq!(meters[0].label, "API credit");
        assert_eq!(meters[0].values[0].number, 0.0);

        let with_grant = balance_meters(10.0, Some((2.5, "Granted")));
        // TWO meters, not two values on one: a renderer reads two same-kind values
        // as "value against cap", so "$10.00/$2.50" would say the opposite of the
        // truth. Every row here therefore carries exactly one figure.
        assert_eq!(with_grant.len(), 2);
        assert!(with_grant.iter().all(|m| m.values.len() == 1));
        assert_eq!(with_grant[1].label, "Granted");
        assert_eq!(with_grant[1].values[0].number, 2.5);
    }

    // ── gates ────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn blank_key_is_not_logged_in_and_unknown_provider_is_unsupported() {
        let blank = fetch_provider_credits("openrouter", "   ").await;
        assert!(matches!(blank.reason, Some(UsageUnavailable::NotLoggedIn)));
        let unknown = fetch_provider_credits("openai", "sk-live").await;
        assert!(matches!(
            unknown.reason,
            Some(UsageUnavailable::Unsupported)
        ));
        assert_eq!(unknown.provider_id, "openai");
    }

    /// Support is decided before the credential check: an unsupported provider
    /// with no key must read `unsupported` (nothing to show, ever), not
    /// `not_logged_in` (which would imply pasting a key would make it work). The
    /// Core handler calls exactly this way, passing no key for such a provider.
    #[tokio::test]
    async fn unsupported_provider_without_a_key_is_still_unsupported() {
        let snap = fetch_provider_credits("anthropic", "").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::Unsupported)));
    }

    // ── OpenRouter ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn openrouter_balance_is_credits_minus_usage() {
        let _g = lock();
        let url = spawn_loopback(
            "200 OK",
            r#"{"data":{"total_credits":50.0,"total_usage":12.25}}"#,
        );
        std::env::set_var("RYU_CREDITS_OPENROUTER_URL", &url);
        let snap = fetch_provider_credits("openrouter", "sk-or-v1").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert!((snap.meters[0].values[0].number - 37.75).abs() < 1e-9);
        clear_env();
    }

    #[tokio::test]
    async fn openrouter_malformed_body_refuses() {
        let _g = lock();
        let url = spawn_loopback("200 OK", r#"{"data":{"total_credits":50.0}}"#);
        std::env::set_var("RYU_CREDITS_OPENROUTER_URL", &url);
        let snap = fetch_provider_credits("openrouter", "sk-or-v1").await;
        assert!(!snap.available);
        assert!(matches!(snap.reason, Some(UsageUnavailable::Error)));
        clear_env();
    }

    #[tokio::test]
    async fn openrouter_maps_401_and_429() {
        let _g = lock();
        let url = spawn_loopback("401 Unauthorized", "{}");
        std::env::set_var("RYU_CREDITS_OPENROUTER_URL", &url);
        assert!(matches!(
            fetch_provider_credits("openrouter", "bad").await.reason,
            Some(UsageUnavailable::TokenExpired)
        ));
        let url = spawn_loopback_with_headers("429 Too Many Requests", "Retry-After: 90\r\n", "{}");
        std::env::set_var("RYU_CREDITS_OPENROUTER_URL", &url);
        let snap = fetch_provider_credits("openrouter", "sk").await;
        assert!(matches!(snap.reason, Some(UsageUnavailable::RateLimited)));
        assert_eq!(snap.retry_after_seconds, Some(90));
        clear_env();
    }

    // ── DeepSeek ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn deepseek_reads_string_amounts_and_prefers_usd() {
        let _g = lock();
        // Amounts as strings (the shape that breaks a naive `as_f64`), and a CNY
        // row first so the USD preference is exercised.
        let url = spawn_loopback(
            "200 OK",
            r#"{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"70.00","granted_balance":"0.00"},{"currency":"USD","total_balance":"9.87","granted_balance":"1.23"}]}"#,
        );
        std::env::set_var("RYU_CREDITS_DEEPSEEK_URL", &url);
        let snap = fetch_provider_credits("deepseek", "sk-ds").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert!((snap.meters[0].values[0].number - 9.87).abs() < 1e-9);
        assert_eq!(snap.meters[1].label, "Granted");
        assert!((snap.meters[1].values[0].number - 1.23).abs() < 1e-9);
        clear_env();
    }

    #[tokio::test]
    async fn deepseek_falls_back_to_the_first_row_without_usd() {
        let _g = lock();
        let url = spawn_loopback(
            "200 OK",
            r#"{"balance_infos":[{"currency":"CNY","total_balance":70.0}]}"#,
        );
        std::env::set_var("RYU_CREDITS_DEEPSEEK_URL", &url);
        let snap = fetch_provider_credits("deepseek", "sk-ds").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.meters[0].values[0].number, 70.0);
        clear_env();
    }

    #[tokio::test]
    async fn deepseek_empty_or_missing_rows_refuse() {
        let _g = lock();
        for body in [r#"{"balance_infos":[]}"#, r#"{"is_available":true}"#] {
            let url = spawn_loopback("200 OK", body);
            std::env::set_var("RYU_CREDITS_DEEPSEEK_URL", &url);
            let snap = fetch_provider_credits("deepseek", "sk-ds").await;
            assert!(!snap.available, "{body}");
            assert!(matches!(snap.reason, Some(UsageUnavailable::Error)));
        }
        clear_env();
    }

    // ── Moonshot ─────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn moonshot_reads_the_international_host() {
        let _g = lock();
        let url = spawn_loopback(
            "200 OK",
            r#"{"code":0,"status":true,"data":{"available_balance":42.5,"voucher_balance":2.0,"cash_balance":40.5}}"#,
        );
        std::env::set_var("RYU_CREDITS_MOONSHOT_URL", &url);
        let snap = fetch_provider_credits("moonshot", "sk-moon").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.meters[0].values[0].number, 42.5);
        assert_eq!(snap.meters[1].label, "Voucher");
        assert_eq!(snap.meters[1].values[0].number, 2.0);
        clear_env();
    }

    /// A mainland key is refused by the international host, so the `.cn` host is
    /// the fallback — not a speculative second call on the happy path.
    #[tokio::test]
    async fn moonshot_falls_back_to_the_mainland_host() {
        let _g = lock();
        std::env::set_var("RYU_CREDITS_MOONSHOT_URL", "http://127.0.0.1:1/intl");
        let cn = spawn_loopback("200 OK", r#"{"data":{"available_balance":7.0}}"#);
        std::env::set_var("RYU_CREDITS_MOONSHOT_CN_URL", &cn);
        let snap = fetch_provider_credits("moonshot", "sk-moon").await;
        assert!(snap.available, "reason={:?}", snap.reason);
        assert_eq!(snap.meters[0].values[0].number, 7.0);
        clear_env();
    }

    #[tokio::test]
    async fn moonshot_reports_the_first_hosts_refusal_when_both_fail() {
        let _g = lock();
        let intl = spawn_loopback("401 Unauthorized", "{}");
        std::env::set_var("RYU_CREDITS_MOONSHOT_URL", &intl);
        std::env::set_var("RYU_CREDITS_MOONSHOT_CN_URL", "http://127.0.0.1:1/cn");
        let snap = fetch_provider_credits("moonshot", "bad").await;
        // The international host's "token expired" survives, rather than the
        // mainland host's inevitable connection error.
        assert!(matches!(snap.reason, Some(UsageUnavailable::TokenExpired)));
        clear_env();
    }

    #[test]
    fn snapshot_serialization_skips_optional_fields() {
        let snap = ProviderCreditsSnapshot::unavailable("openai", UsageUnavailable::Unsupported);
        let value = serde_json::to_value(&snap).unwrap();
        let obj = value.as_object().unwrap();
        assert_eq!(obj.get("provider_id").unwrap(), "openai");
        assert_eq!(obj.get("available").unwrap(), false);
        assert_eq!(obj.get("reason").unwrap(), "unsupported");
        assert!(!obj.contains_key("retry_after_seconds"));
        // The key must never appear anywhere in the response body.
        assert!(!serde_json::to_string(&snap).unwrap().contains("sk-"));
    }
}
