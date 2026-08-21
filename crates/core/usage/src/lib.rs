//! Per-agent subscription usage-metering primitive for Ryu (`crates/ryu-usage`)
//! — the "usage bar" feature, à la CodexBar / openusage. When an ACP agent that
//! runs on its own subscription is active in chat (Claude Code, Codex), the
//! desktop shows that agent's rolling rate-limit windows — the 5h "session"
//! window and the weekly window — so the user can see how close they are to
//! their plan's cap.
//!
//! Placement (Core vs Gateway, AGENTS.md §1): reading an agent's own vendor
//! usage windows is part of *what runs* (observing the active agent), so it
//! lives in Core; this crate is consumed as a NON-optional path dependency (the
//! `GET /api/agents/:id/usage` route is mounted unconditionally). It has ZERO
//! dependency on `apps/core`: its one kernel coupling — the Ryu-isolated
//! `CODEX_HOME` — inverts through the narrow [`UsageHost`] trait installed at
//! boot ([`set_global_host`]). Later this feeds the Gateway's budget cross-tier
//! picture; for now it is read-only, poll-driven, and side-effect-free.
//!
//! ## How the data is sourced
//!
//! These agents bypass Ryu's Gateway (they talk to the vendor directly with the
//! user's own subscription credential), so Ryu can't observe their token spend.
//! Instead — exactly like CodexBar/openusage — we read the credential the CLI
//! already stored on this machine and call the *same* usage endpoint the vendor's
//! own tool calls:
//!
//! - **Codex** (`acp:codex`): `~/.codex/auth.json` →
//!   `GET chatgpt.com/backend-api/wham/usage` plus the best-effort
//!   `…/wham/rate-limit-reset-credits`. Session/weekly windows are classified by
//!   each window's own `limit_window_seconds` (Codex can move a sole weekly
//!   limit into the `primary_window` slot), the Spark model limits come from
//!   `additional_rate_limits`, and the banked rate-limit reset credits carry one
//!   expiry date *per credit*.
//! - **Claude** (`acp:claude`): `~/.claude/.credentials.json` or the macOS
//!   Keychain → `GET api.anthropic.com/api/oauth/usage` (`five_hour`,
//!   `seven_day`, the model-scoped `limits[]` weekly windows, `extra_usage`).
//! - **Copilot** (`acp:copilot`): the GitHub token Copilot tooling already left
//!   on disk (`~/.config/github-copilot/apps.json`, `gh`'s `hosts.yml`, or the
//!   `gh:github.com` Keychain item) → `GET api.github.com/copilot_internal/user`
//!   (AI-credit pool, overage, chat/completions).
//! - **Grok** (`acp:grok`): `~/.grok/auth.json` →
//!   `GET cli-chat-proxy.grok.com/v1/billing?format=credits` (the shared weekly
//!   pool + the pay-as-you-go cap) and `/v1/settings` for the plan name.
//! - **GLM / Z.ai** (`acp:glm`): a `ZAI_API_KEY` / `GLM_API_KEY` (Z.ai ships no
//!   CLI whose credential we could reuse) → `api.z.ai`'s quota + subscription
//!   endpoints (5h session, weekly, monthly web-search count).
//!
//! ## Why we never refresh the token
//!
//! These OAuth refresh tokens are single-use (they rotate on every refresh). If
//! Ryu refreshed, it would consume the refresh token the *real* CLI still has
//! stored — the CLI's next refresh would then fail with `refresh_token_reused`
//! and **log the user out of their coding agent**. So we only ever *read* the
//! access token and check its expiry locally (Claude carries `expiresAt`; Codex's
//! access token is a JWT with an `exp` claim). If it's still fresh we call the
//! usage API; if it's expired we return a structured "expired" snapshot and let
//! the real CLI refresh on its own next use. Because the feature targets the
//! *active* agent — which just used (and so just refreshed) its own token — a
//! fresh token is the common case.
//!
//! Tokens NEVER appear in logs or in the response body. The endpoint returns
//! normalized snapshots only.
//!
//! ## Known gaps (scoped, not silent)
//!
//! - **Remote node**: Core reads *its own* machine's `~/.codex`/`~/.claude`/…
//!   For local Core (the common case) that's where the agents run, so it's
//!   correct; a remote node would report its own creds, not the user's laptop's.
//! - **Cursor** (`acp:cursor`): its usage lives behind Connect RPC on
//!   `api2.cursor.sh` with the session token in Cursor's local SQLite state DB,
//!   and openusage's reader *persists rotated tokens back*. Both the SQLite
//!   dependency and the write-back conflict with this crate's read-only,
//!   never-refresh posture, so it stays `unsupported` for now.
//! - **Gemini / Antigravity** (`acp:gemini`): two sources, neither cheap. The
//!   local one means discovering Antigravity's language-server process and
//!   reading its CSRF token and ports — no refresh needed, but it only answers
//!   while the app is running. The remote one reaches Google's Cloud Code API
//!   with a token from Antigravity's Keychain item, which openusage *refreshes*
//!   through Google OAuth — exactly what this crate must never do (see above).
//!   Deferred on cost, not on principle; the local path is the way in if it's
//!   picked up.
//! - **Droid / Qwen / CodeBuddy / Pi / Ryu's own portal**: no readable
//!   subscription usage window → `unsupported`, which makes the desktop bar
//!   hide rather than error. Ryu's ChatGPT / Claude / Copilot provider logins
//!   are different: they reuse the provider's normal subscription endpoint
//!   through the managed Pi credential store.
//! - **Local spend tiles**: openusage/CodexBar also estimate Today / Yesterday /
//!   Last-30-days *cost* by scanning each CLI's own session logs and pricing the
//!   token counts locally. That is a separate concern from a rate-limit window
//!   (and Ryu already meters Gateway-routed spend), so it is out of scope here.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;

// ── Kernel seam ──────────────────────────────────────────────────────────────

/// The narrow seam this crate needs from `apps/core`'s kernel machinery. It
/// carries ONLY the one path coupling the Codex reader uses: the *Ryu-isolated*
/// `CODEX_HOME` (`RYU_CODEX_HOME` override, else the profile/relocation-aware
/// `~/.ryu/codex-home`). That path resolves through Core's active data dir — a
/// kernel concept — so it cannot live in this crate. `apps/core` implements this
/// once (`crate::usage_host::CoreUsageHost`) and installs it at boot via
/// [`set_global_host`]. Everything else (the vendor endpoints, the never-refresh
/// token safety, the `~/.codex` / `~/.config/codex` defaults) stays in-crate.
pub trait UsageHost: Send + Sync {
    /// The Ryu-isolated `CODEX_HOME` — where a Codex logged in only through Ryu's
    /// gateway-passthrough path keeps its `auth.json`. The last candidate the
    /// Codex reader probes after the user's own `~/.codex` / `~/.config/codex`.
    fn ryu_codex_home(&self) -> PathBuf;

    /// The managed Pi's isolated `auth.json`, where Ryu's subscription-login
    /// providers store their OAuth credentials. Optional so extracted crate
    /// tests and hosts that only need the Codex seam remain minimal.
    fn ryu_pi_auth_path(&self) -> Option<PathBuf> {
        None
    }
}

/// Process-global usage host, installed once at boot by `apps/core`.
fn host_slot() -> &'static OnceLock<Arc<dyn UsageHost>> {
    static HOST: OnceLock<Arc<dyn UsageHost>> = OnceLock::new();
    &HOST
}

/// Install the host implementation. Called once from `apps/core` at startup.
/// Idempotent: a second call is ignored. Unlike crypto's fail-hard host, this one
/// is fetched fallibly ([`host`]): usage backs a polled widget, never a hot path,
/// so if the host is absent (e.g. a crate-level unit test that never runs `main`)
/// the Codex reader simply skips the Ryu-isolated candidate rather than panicking.
pub fn set_global_host(host: Arc<dyn UsageHost>) {
    let _ = host_slot().set(host);
}

/// Fetch the installed host, or `None` if [`set_global_host`] was never called.
fn host() -> Option<Arc<dyn UsageHost>> {
    host_slot().get().cloned()
}

/// One rolling rate-limit window, normalized across vendors. `used_percent` is
/// 0–100; `resets_at` is RFC3339 when known.
#[derive(Debug, Clone, Serialize)]
pub struct UsageWindow {
    /// Human label: "Session" (5h), "Weekly", "Spark", a model display name
    /// ("Sonnet" / "Opus" / …), …
    pub label: String,
    /// Percent of the window's cap consumed (0–100).
    pub used_percent: f64,
    /// When this window resets, RFC3339, if the vendor told us.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
    /// The window's own length in seconds, when the vendor reports it
    /// (Codex's `limit_window_seconds`, Grok's period, Z.ai's `unit`×`number`).
    /// Lets the client label a meter from the data ("5h" / "7d") instead of
    /// pattern-matching a closed set of English labels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_seconds: Option<i64>,
    /// The model this window is scoped to, when it is a per-model limit rather
    /// than an account-wide one: Claude's `limits[]` weekly-scoped windows
    /// (Sonnet, Opus, …) and Codex's Spark pair.
    ///
    /// This exists so a client can attach a quota to the right model row WITHOUT
    /// guessing from the label. Inferring it — "a label that isn't Session or
    /// Weekly must name a model" — needs a closed set of non-model labels, and
    /// the moment one is missed (Copilot reports `Chat` and `Completions`; Z.ai
    /// reports `Daily`) a client would hang an account-wide quota off whichever
    /// model happened to share the word. `None` means account-wide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// What a [`UsageValue`]'s `number` means, so the client formats it without
/// parsing the label.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageValueKind {
    /// 0–100, a share of some cap.
    Percent,
    /// US dollars.
    Dollars,
    /// A bare count (credits, banked resets, web searches).
    Count,
}

/// One figure inside a [`UsageMeter`]. A meter can carry more than one — Codex's
/// credit balance reads as a dollar value *and* a credit count.
#[derive(Debug, Clone, Serialize)]
pub struct UsageValue {
    pub number: f64,
    pub kind: UsageValueKind,
    /// Unit noun for the client's label ("credits", "available", "searches",
    /// "cap"). `None` when the `kind` already says everything.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

impl UsageValue {
    fn new(number: f64, kind: UsageValueKind, unit: Option<&str>) -> Self {
        Self {
            number,
            kind,
            unit: unit.map(str::to_string),
        }
    }
}

/// A usage row that is NOT a 0–100 bar: a credit balance, the count of banked
/// rate-limit resets, dollars of extra usage, a monthly web-search count. Kept
/// in its own array so [`UsageWindow`] stays a pure percent meter and the
/// desktop's bar geometry never has to render a number that isn't a percentage.
#[derive(Debug, Clone, Serialize)]
pub struct UsageMeter {
    /// Human label: "Credits", "Rate limit resets", "Extra usage", …
    pub label: String,
    /// The figures on this row, in display order.
    pub values: Vec<UsageValue>,
    /// One expiry per underlying item, RFC3339, soonest-first. Codex's banked
    /// rate-limit reset credits each expire on their *own* date, so a single
    /// `resets_at` cannot represent them — the client renders this as a timeline.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub expires_at: Vec<String>,
    /// When the whole row's period rolls over, RFC3339, when the vendor says so
    /// (e.g. Copilot's monthly credit reset).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
}

impl UsageMeter {
    fn new(label: &str, values: Vec<UsageValue>) -> Self {
        Self {
            label: label.to_string(),
            values,
            expires_at: Vec::new(),
            resets_at: None,
        }
    }

    fn with_resets_at(mut self, resets_at: Option<String>) -> Self {
        self.resets_at = resets_at;
        self
    }

    fn with_expiries(mut self, expires_at: Vec<String>) -> Self {
        self.expires_at = expires_at;
        self
    }
}

/// Why a snapshot has no live windows. Drives the desktop's decision to hide
/// (unsupported) vs. show a hint (the rest).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageUnavailable {
    /// The active agent has no subscription usage window we can read.
    Unsupported,
    /// No credential file / token on disk — the user hasn't logged into the CLI.
    NotLoggedIn,
    /// The stored access token is expired; the real CLI will refresh it on next
    /// use. We deliberately don't refresh (single-use refresh tokens).
    TokenExpired,
    /// The stored token can authenticate for inference but lacks the scope the
    /// usage endpoint needs (e.g. a `claude setup-token` token without
    /// `user:profile`).
    MissingScope,
    /// The credential authenticates fine, but the account carries no metered
    /// subscription to report (a Z.ai key with no GLM Coding Plan, a Copilot
    /// org-managed seat that exposes no per-seat quota). Not an error — there is
    /// genuinely nothing to meter.
    NoPlan,
    /// The vendor's usage endpoint rate-limited us. Back off; try later.
    RateLimited,
    /// The usage call failed (network / non-2xx / unparseable). Transient.
    Error,
}

/// A normalized usage snapshot for one agent. Always 200 from the endpoint;
/// refusals carry `available=false` + a `reason` rather than an HTTP error, so
/// the desktop never branches on status codes.
#[derive(Debug, Clone, Serialize)]
pub struct UsageSnapshot {
    /// The agent id this snapshot is for (echoed back).
    pub agent_id: String,
    /// The engine we resolved it to ("claude" | "codex"), or "" if unsupported.
    pub engine: String,
    /// Whether `windows` carry live data.
    pub available: bool,
    /// Plan label when known ("Max 20x", "Pro", …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Set when `available=false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<UsageUnavailable>,
    /// The rolling percent windows (Session / Weekly / …). Empty when unavailable.
    pub windows: Vec<UsageWindow>,
    /// The non-percent rows: credit balances, the banked rate-limit reset count
    /// and its per-credit expiries, extra-usage dollars, web-search counts.
    /// Empty for a vendor that reports only percent windows.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub meters: Vec<UsageMeter>,
    /// Pay-as-you-go "extra usage" dollars spent this month, when the plan has it
    /// enabled (Claude only). Kept alongside the equivalent [`UsageMeter`] row so
    /// existing clients don't break.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_usage_usd: Option<f64>,
    /// Seconds the vendor asked us to wait, from a 429's `Retry-After`. Only set
    /// with `reason = rate_limited`; lets the client say *when* instead of just
    /// "rate limited".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<i64>,
}

impl UsageSnapshot {
    fn unavailable(agent_id: &str, engine: &str, reason: UsageUnavailable) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            engine: engine.to_string(),
            available: false,
            plan: None,
            reason: Some(reason),
            windows: Vec::new(),
            meters: Vec::new(),
            extra_usage_usd: None,
            retry_after_seconds: None,
        }
    }

    /// An `available = true` snapshot for one engine; the caller fills in the
    /// windows/meters it read.
    fn available(agent_id: &str, engine: &str, plan: Option<String>) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            engine: engine.to_string(),
            available: true,
            plan,
            reason: None,
            windows: Vec::new(),
            meters: Vec::new(),
            extra_usage_usd: None,
            retry_after_seconds: None,
        }
    }
}

/// The subscription engines we can read usage for. Derived from the agent id.
/// Each reader owns the wire `engine` string it echoes back (and pins it in its
/// own tests), so this carries only the dispatch identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Engine {
    Claude,
    Codex,
    Copilot,
    Grok,
    /// Z.ai's GLM Coding Plan (`acp:glm`).
    Glm,
}

/// Curated ACP ids → engine. Matched exactly *first* so a growing substring
/// chain can never make the mapping order-dependent (`acp:claude-code` and a
/// hypothetical `acp:codex-claude-bridge` would both otherwise depend on which
/// `contains` ran first).
const AGENT_ENGINES: &[(&str, Engine)] = &[
    ("acp:claude", Engine::Claude),
    ("acp:codex", Engine::Codex),
    ("acp:copilot", Engine::Copilot),
    ("acp:grok", Engine::Grok),
    ("acp:glm", Engine::Glm),
];

/// The canonical agent ids [`AGENT_ENGINES`] maps, in a stable order — the whole
/// set of agents whose subscription windows this crate can read.
///
/// Exported so a caller that wants to *shop across* plans (rather than read one
/// agent it was handed) has a candidate pool it did not have to hardcode. Ryu's
/// reactive failover uses it: when the agent running a turn hits its cap, the
/// pool is every other id here, minus the ones whose snapshot comes back
/// `NotLoggedIn` / `NoPlan` / `Unsupported`.
///
/// Derived from [`AGENT_ENGINES`] rather than written twice — the
/// `subscription_agents_cover_every_engine` test pins the two together, so
/// adding a reader without adding it to the pool fails the build's test run
/// rather than silently shipping an agent nobody can fail over to.
pub const SUBSCRIPTION_AGENTS: &[&str] = &[
    "acp:claude",
    "acp:codex",
    "acp:copilot",
    "acp:grok",
    "acp:glm",
];

/// Substring fallbacks for engine-direct / custom ids built on the same CLI
/// ("claude", "my-codex-agent"). Ordered most-specific-first; only consulted
/// after every exact match missed.
const ENGINE_SUBSTRINGS: &[(&str, Engine)] = &[
    ("claude", Engine::Claude),
    ("codex", Engine::Codex),
    ("copilot", Engine::Copilot),
    ("grok", Engine::Grok),
    ("glm", Engine::Glm),
    ("zai", Engine::Glm),
];

/// Map an agent id to the subscription engine whose usage we can read, or `None`
/// for agents with no readable subscription window.
fn engine_for_agent(agent_id: &str) -> Option<Engine> {
    let id = agent_id.trim().to_ascii_lowercase();
    if let Some((_, engine)) = AGENT_ENGINES.iter().find(|(candidate, _)| *candidate == id) {
        return Some(*engine);
    }
    ENGINE_SUBSTRINGS
        .iter()
        .find(|(needle, _)| id.contains(needle))
        .map(|(_, engine)| *engine)
}

/// Public entry point used by the HTTP handler. Never errors — always returns a
/// snapshot (refusals carry a `reason`).
pub async fn fetch_usage(agent_id: &str) -> UsageSnapshot {
    let Some(engine) = engine_for_agent(agent_id) else {
        return UsageSnapshot::unavailable(agent_id, "", UsageUnavailable::Unsupported);
    };
    match engine {
        Engine::Claude => claude::fetch(agent_id).await,
        Engine::Codex => codex::fetch(agent_id).await,
        Engine::Copilot => copilot::fetch(agent_id).await,
        Engine::Grok => grok::fetch(agent_id).await,
        Engine::Glm => glm::fetch(agent_id).await,
    }
}

/// Fetch usage for a provider that was logged in through Ryu's managed Pi.
///
/// Ryu's OAuth bridge stores credentials in its isolated Pi `auth.json`, not in
/// the vendor CLI files the ACP readers normally scan. The HTTP contract and
/// normalization stay identical; only the read-only credential source changes.
pub async fn fetch_ryu_provider_usage(provider_id: &str) -> UsageSnapshot {
    let Some(engine) = engine_for_agent(provider_id) else {
        return UsageSnapshot::unavailable(provider_id, "", UsageUnavailable::Unsupported);
    };
    match engine {
        Engine::Claude => claude::fetch_ryu(provider_id).await,
        Engine::Codex => codex::fetch_ryu(provider_id).await,
        Engine::Copilot => copilot::fetch_ryu(provider_id).await,
        // Ryu currently exposes OAuth login providers for these three engines.
        // Keep the fallback conservative if a future provider is routed here
        // before it has a Pi-auth reader of its own.
        Engine::Grok | Engine::Glm => fetch_usage(provider_id).await,
    }
}

/// Shared HTTP client for the vendor usage calls. Short timeout — this backs a
/// polled widget, never a hot path.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .unwrap_or_default()
}

/// Unix-seconds expiry from a JWT's `exp` claim, read WITHOUT verifying the
/// signature (we only need the claim, never trust it). Returns `None` when the
/// token isn't a 3-part JWT or has no numeric `exp`.
fn jwt_exp_unix(token: &str) -> Option<i64> {
    use base64::Engine as _;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(payload))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("exp").and_then(serde_json::Value::as_i64)
}

/// Read a small credential file as text, or `None` if it's missing/unreadable.
fn read_file(path: &PathBuf) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// The `~/.config` root the CLI-adjacent credential files live under.
///
/// `XDG_CONFIG_HOME` is honoured because the tools we read from do (the Copilot
/// editor plugins and `gh` both write under it when it's set) — note this is
/// deliberately NOT `dirs::config_dir()`, which resolves to
/// `~/Library/Application Support` on macOS where those tools still use
/// `~/.config`.
///
/// The `#[cfg(test)]` override exists so a reader's credential scan can be made
/// hermetic without reassigning the process-global `HOME`, which sibling readers'
/// tests also depend on — two modules racing on `HOME` is a flaky suite.
fn config_home() -> Option<PathBuf> {
    #[cfg(test)]
    {
        if let Some(dir) = std::env::var_os("RYU_USAGE_CONFIG_HOME") {
            let path = PathBuf::from(dir);
            if !path.as_os_str().is_empty() {
                return Some(path);
            }
        }
    }
    if let Some(dir) = std::env::var_os("XDG_CONFIG_HOME") {
        let path = PathBuf::from(dir);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    dirs::home_dir().map(|home| home.join(".config"))
}

/// Map a reqwest status to the unavailable reason a non-2xx implies.
fn reason_for_status(status: reqwest::StatusCode) -> UsageUnavailable {
    match status.as_u16() {
        401 | 403 => UsageUnavailable::TokenExpired,
        429 => UsageUnavailable::RateLimited,
        _ => UsageUnavailable::Error,
    }
}

/// Hold a percentage inside 0–100. Vendors occasionally report slightly over
/// 100 (or a negative remaining), and a bar can't render that.
fn clamp_percent(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

/// A `Retry-After` header in seconds. Only the delta-seconds form is honoured —
/// the HTTP-date form is rare here and a wrong parse would report a nonsense
/// countdown, so an unparseable value yields `None` ("rate limited, try later")
/// rather than a fabricated number.
fn retry_after_seconds(headers: &reqwest::header::HeaderMap) -> Option<i64> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|seconds| *seconds >= 0)
}

/// Epoch **seconds** → RFC3339.
fn epoch_secs_to_rfc3339(epoch: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(epoch, 0).map(|dt| dt.to_rfc3339())
}

/// Epoch **milliseconds** → RFC3339 (Z.ai's `nextResetTime`).
fn epoch_millis_to_rfc3339(millis: f64) -> Option<String> {
    if !millis.is_finite() {
        return None;
    }
    chrono::DateTime::from_timestamp_millis(millis as i64).map(|dt| dt.to_rfc3339())
}

/// A timestamp that may arrive as an ISO-8601 string *or* an epoch number,
/// normalized to RFC3339. Used for the fields where vendors have shipped both
/// shapes (Codex's per-credit `expires_at`, Copilot's reset dates). A bare
/// `yyyy-mm-dd` (Copilot's free tier) is read as midnight UTC.
fn timestamp_to_rfc3339(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
            return Some(parsed.with_timezone(&chrono::Utc).to_rfc3339());
        }
        if let Ok(date) = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d") {
            return Some(date.and_hms_opt(0, 0, 0)?.and_utc().to_rfc3339());
        }
        return None;
    }
    let number = value.as_f64()?;
    if !number.is_finite() {
        return None;
    }
    // Anything past ~year 2286 in seconds is really milliseconds — the same
    // heuristic openusage uses, so both shapes of the same field land right.
    if number.abs() >= 1e11 {
        epoch_millis_to_rfc3339(number)
    } else {
        epoch_secs_to_rfc3339(number as i64)
    }
}

/// Title-case one token: `"plus"` / `"PRO"` → `"Plus"` / `"Pro"`. Words are split
/// on `separators` so `"copilot_pro"` reads "Copilot Pro".
fn title_case(value: &str, separators: &[char]) -> String {
    value
        .trim()
        .split(|c: char| separators.contains(&c))
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    first.to_ascii_uppercase().to_string() + &chars.as_str().to_ascii_lowercase()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

mod claude;
mod codex;
mod copilot;
mod glm;
mod grok;
mod provider_credits;

pub use provider_credits::{
    fetch_provider_credits, supports_provider_credits, ProviderCreditsSnapshot,
    PROVIDERS_WITH_CREDITS,
};

#[cfg(test)]
mod tests;
