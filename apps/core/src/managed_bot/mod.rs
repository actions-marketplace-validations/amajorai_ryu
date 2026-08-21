//! Managed-bot pairing — how a Telegram child bot's token reaches THIS node
//! without the user ever opening @BotFather.
//!
//! Telegram Bot API 9.6 ("managed bots") lets a *manager* bot create bots owned by
//! a user. Every 9.6 surface — `can_manage_bots`, `request_managed_bot`,
//! `Update.managed_bot`, `getManagedBotToken` — lands on the MANAGER, which for Ryu
//! is the hosted `apps/cloud-bot` service, not this node and not the child bot. The
//! child bot is served by the EXISTING, untouched Rust adapter
//! (`crates/gateway/channels/src/telegram.rs`), which only ever wants one thing:
//! `StoredBotConfig.secrets["bot_token"]`. So the only new mechanism is **how the
//! token arrives**, and this module is the node's half of it:
//!
//! 1. `POST {manager}/managed-bot/pair` mints a `(nonce, claim_secret)` pair.
//!    The nonce is PUBLIC — it rides a deep link and a QR the user may put on
//!    screen. The claim_secret NEVER leaves the node and is required to claim, so a
//!    shoulder-surfed nonce alone yields nothing.
//! 2. The user opens the deep link, presses Start, taps the `request_managed_bot`
//!    button; the manager fetches the new bot's token via `getManagedBotToken`.
//! 3. The node polls `GET {manager}/managed-bot/claim/{nonce}` with the
//!    claim_secret as a bearer until it answers `ready`, then writes the token into
//!    the SAME place a hand-pasted token goes.
//!
//! **Placement.** Core owns no channel-config storage — the channel bot config
//! lives in the control plane (`packages/api` → Mongo `channelConfig`, secrets
//! sealed per value). This module therefore *drives* the existing write path
//! (`POST /api/channels`, `PATCH /api/channels/:id`) as an HTTP client with the
//! device account's bearer, exactly like [`crate::server::sync::SyncClient`] does
//! for conversations. There is deliberately no second store: the token, the
//! claim_secret and the nonce all end up in the one `secrets` map the gateway
//! already reads, so the existing reload spawns the child adapter with zero
//! adapter changes.
//!
//! **Secret hygiene.** A bot token is a full credential and the claim_secret is the
//! only thing standing between a public nonce and that credential. Both are wrapped
//! in [`Secret`], which has a redacting `Debug` and — on purpose — no `Serialize`
//! and no `Display`: a secret cannot reach a response body, a log line or the
//! OpenAPI schema by accident, only through an explicit [`Secret::expose`] at the
//! two call sites that must send it. Manager responses are never echoed into an
//! error, because a manager response body *is* the token.

use std::{
    collections::HashMap,
    fmt,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Base URL of the manager service (`apps/cloud-bot`). Overridable so a dev node
/// can point at a locally-run manager; the default is the hosted one.
pub const MANAGER_URL_ENV: &str = "RYU_MANAGED_BOT_URL";
/// Hosted manager. Resolution order is explicit arg → env → this, matching the
/// `RyuMarketplaceSource` convention for Core → Ryu-hosted-service clients.
pub const DEFAULT_MANAGER_BASE: &str = "https://bot.ryuhq.com";

/// Control-plane origin that owns channel configs. Same env name
/// [`crate::server::sync::SyncClient`] already resolves — one origin, one variable.
const CONTROL_PLANE_URL_ENV: &str = "RYU_SERVER_URL";
const DEFAULT_CONTROL_PLANE_BASE: &str = "http://localhost:3000";

/// Every manager call is a short control-plane round trip; a hung manager must not
/// wedge a desktop poll.
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// Hard local ceiling on a pairing's lifetime, applied on top of the manager's own
/// `expires_at`. The contract says the manager expires a pairing after 10 minutes;
/// this ceiling means a manager that returns an absurd (or unparseable) expiry
/// still cannot leave a claim_secret resident forever. Mirrors the
/// `SUPPORT_ACCESS_MAX_DURATION_MS` "hard ceiling re-checked on every read" idiom.
const PAIRING_MAX_TTL_MS: i64 = 15 * 60 * 1000;

/// Minimum spacing between upstream claim polls for one nonce. The desktop drives
/// this route on a timer, so without a floor a render loop would turn into an
/// unbounded poll of the manager. Below the floor the node answers `waiting` from
/// its own state and makes no network call.
const MIN_POLL_INTERVAL_MS: i64 = 1_500;

/// A nonce is interpolated into a URL PATH, and on the poll route it arrives from a
/// client. Accepting only base32url/hex-safe characters is what keeps
/// `claim/{nonce}` from being walked out of its path segment. The contract mints
/// 32+ characters; the floor here is lower because the security property is the
/// charset, and refusing a shorter-but-well-formed manager nonce would break
/// pairing for a cosmetic reason.
const NONCE_MIN_LEN: usize = 16;
const NONCE_MAX_LEN: usize = 128;

// ── Secret wrapper ───────────────────────────────────────────────────────────

/// A live credential (a bot token or a claim_secret).
///
/// Deliberately NOT `Serialize` and NOT `Display`: those are the two ways a secret
/// escapes into a JSON response, a `format!`, or a utoipa schema, and their absence
/// makes the escape a compile error rather than a review question. `Debug` prints a
/// placeholder so a `?struct` in a `tracing` call stays safe.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    /// Wrap a value that is already a secret.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The raw value. Every call site is a place where the secret leaves the
    /// process on purpose (an `Authorization` header, or the `secrets` map written
    /// to the control plane) — there should never be a third kind.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.trim().is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> std::result::Result<Self, D::Error> {
        Ok(Self(String::deserialize(de)?))
    }
}

// ── Wire types ───────────────────────────────────────────────────────────────

/// What the node asks the manager for when it starts a pairing.
///
/// `suggested_name` / `suggested_username` are forwarded verbatim into the
/// manager's `KeyboardButtonRequestManagedBot`, where Telegram treats them as
/// suggestions the user may edit. Both are optional; a manager that ignores them
/// still pairs.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PairRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_username: Option<String>,
}

/// A minted pairing. `nonce`, `deep_link` and `expires_at` are safe to hand to a
/// client; `claim_secret` is not, which is why it is a [`Secret`].
#[derive(Debug, Clone, Deserialize)]
pub struct PairSession {
    pub nonce: String,
    pub claim_secret: Secret,
    pub deep_link: String,
    /// RFC3339, echoed to the client verbatim so the UI can render a countdown
    /// without inventing its own clock.
    pub expires_at: String,
}

/// A managed bot the manager is holding a token for. `bot_id` / `bot_username` are
/// public identifiers and are logged; `token` is not.
#[derive(Debug, Clone, Deserialize)]
pub struct ManagedBot {
    pub token: Secret,
    pub bot_id: i64,
    #[serde(default)]
    pub bot_username: String,
    #[serde(default)]
    pub owner_telegram_user_id: Option<i64>,
}

/// What the desktop shows a human before a managed token becomes their bot.
///
/// Public identifiers only — the token never leaves the node, so this is the whole
/// basis for the decision. `owner_telegram_user_id` is the load-bearing field: the
/// manager binds a pairing to whoever opens the deep link first, so an owner that is
/// not the account the person at this desktop just used means the pairing was taken
/// by someone else and the bot is theirs, not the user's.
#[derive(Debug, Clone)]
pub struct ConfirmationView {
    pub bot_id: i64,
    pub bot_username: String,
    pub owner_telegram_user_id: Option<i64>,
}

impl ConfirmationView {
    fn of(bot: &ManagedBot) -> Self {
        Self {
            bot_id: bot.bot_id,
            bot_username: bot.bot_username.clone(),
            owner_telegram_user_id: bot.owner_telegram_user_id,
        }
    }
}

/// The answers `GET /managed-bot/claim/{nonce}` can give.
#[derive(Debug)]
pub enum ClaimStatus {
    /// The user has not created the bot yet. Keep polling.
    Pending,
    /// The token is ready — returned exactly ONCE by the manager.
    Ready(Box<ManagedBot>),
    /// The one-shot claim was already spent. NOT an expiry: the managed-bot record
    /// survives a claim, so the token is still reachable through `refresh` — which
    /// is the only way to recover a claim whose HTTP response was lost in flight.
    AlreadyClaimed,
    /// Unknown or expired nonce (HTTP 404). Terminal: stop polling.
    Gone,
}

/// The manager is not serving managed bots at all.
///
/// A distinct error type rather than a message, because it is the ONE failure the
/// desktop must not retry: it means a human has to flip Bot Management Mode on in
/// @BotFather (or set the manager's encryption key), so the UI falls back to the
/// paste-a-token form instead of showing a "try again" button that never will.
/// Raised for the manager's own 501 and for a 404 on `pair` (routes not mounted).
#[derive(Debug, Clone, Copy)]
pub struct ManagerUnavailable {
    /// What the manager answered, for the operator-facing detail line.
    pub status: u16,
}

impl fmt::Display for ManagerUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the managed-bot manager is not serving managed bots (HTTP {}) — Bot Management Mode is off for Ryu's bot, or the manager cannot encrypt tokens at rest",
            self.status
        )
    }
}

impl std::error::Error for ManagerUnavailable {}

/// True when `err` (or anything it wraps) is a [`ManagerUnavailable`].
pub fn is_manager_unavailable(err: &anyhow::Error) -> bool {
    err.downcast_ref::<ManagerUnavailable>().is_some()
}

// ── URL / body construction (pure, so it is unit-testable) ───────────────────

/// Resolve the manager base: explicit env override, else the hosted default.
/// Trailing slashes are trimmed so joining never doubles one.
pub fn manager_base() -> String {
    std::env::var(MANAGER_URL_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_MANAGER_BASE.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn control_plane_base() -> String {
    std::env::var(CONTROL_PLANE_URL_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_CONTROL_PLANE_BASE.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn pair_url(base: &str) -> String {
    format!("{}/managed-bot/pair", base.trim_end_matches('/'))
}

fn claim_url(base: &str, nonce: &str) -> String {
    format!("{}/managed-bot/claim/{nonce}", base.trim_end_matches('/'))
}

/// `refresh` / `rotate` / `delete` share one shape: a POST to
/// `/managed-bot/<action>` authenticated by the claim_secret, with the nonce in the
/// body.
fn action_url(base: &str, action: &str) -> String {
    format!("{}/managed-bot/{action}", base.trim_end_matches('/'))
}

fn action_body(nonce: &str) -> Value {
    json!({ "nonce": nonce })
}

/// Reject a nonce that is not a bare base32url/hex token before it reaches a URL
/// path or the pending map.
pub fn validate_nonce(nonce: &str) -> Result<()> {
    if nonce.len() < NONCE_MIN_LEN || nonce.len() > NONCE_MAX_LEN {
        bail!("managed-bot nonce must be {NONCE_MIN_LEN}..={NONCE_MAX_LEN} characters");
    }
    if !nonce
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        bail!("managed-bot nonce contains characters outside [A-Za-z0-9_-]");
    }
    Ok(())
}

/// The body that creates a Telegram channel config carrying a managed token.
///
/// Three deliberate choices:
/// - `secrets.bot_token` is the key the untouched adapter reads, so a managed token
///   is indistinguishable from a pasted one downstream.
/// - `managed_bot_secret` / `managed_bot_nonce` ride along so rotation survives a
///   node restart. The control plane only enforces the *required* keys per channel
///   type, so extra keys persist (sealed) rather than 400.
/// - every other field comes from [`ChannelIntent`] — the form the user filled in
///   minutes earlier. The control plane defaults each one when it is absent
///   (`enabled: body.enabled === true`, `agentId: null`, the default reply mode), so
///   an intent field this body drops is a user choice silently discarded.
pub fn create_channel_body(
    name: &str,
    bot_token: &str,
    claim_secret: &str,
    nonce: &str,
    intent: &ChannelIntent,
) -> Value {
    let mut body = json!({
        "channelType": "telegram",
        "name": name,
        // Explicit, because the control plane reads `body.enabled === true`: omitting
        // it would silently disable a bot the user asked to switch on.
        "enabled": intent.enabled,
        "secrets": {
            "bot_token": bot_token,
            "managed_bot_secret": claim_secret,
            "managed_bot_nonce": nonce,
        },
    });
    // A team binding and an agent binding are mutually exclusive in the control
    // plane, and the desktop's single picker already resolved which one this is, so
    // whichever arrived is the one sent.
    for (key, value) in [
        ("agentId", intent.agent_id.as_deref()),
        ("teamId", intent.team_id.as_deref()),
        ("model", intent.model.as_deref()),
        ("systemPrompt", intent.system_prompt.as_deref()),
        ("groupReplyMode", intent.group_reply_mode.as_deref()),
        ("proactiveTarget", intent.proactive_target.as_deref()),
    ] {
        if let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) {
            body[key] = json!(value);
        }
    }
    body["proactiveOpening"] = json!(intent.proactive_opening);
    body
}

/// Everything a channel config needs that the *bot* cannot supply: the add-channel
/// form, carried across the pairing.
///
/// It has to be carried because the config is written by a POLL, minutes after the
/// form is gone — the bot does not exist when the user presses the button, so there
/// is nothing to write it against yet. A field missing here is a user choice that
/// silently reverts to a default: that is exactly how a managed bot ended up bound
/// to no agent, with the default reply mode, ignoring the Enabled switch.
#[derive(Debug, Clone)]
pub struct ChannelIntent {
    /// Name for the config. Falls back to the created bot's `@handle`.
    pub name: Option<String>,
    /// Existing config to PATCH instead of creating a new one. Also the seam a
    /// later "rotate this bot's token" flow reuses.
    pub channel_id: Option<String>,
    pub agent_id: Option<String>,
    pub team_id: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub group_reply_mode: Option<String>,
    /// Send Ryu's first plain-language welcome to the approved target when the
    /// gateway starts. The target is deliberately explicit; it is never inferred
    /// from a token or broadcast to a whole platform.
    pub proactive_opening: bool,
    pub proactive_target: Option<String>,
    /// The form's Enabled switch. Honoured rather than forced on: the manual paste
    /// path respects it, and a disabled row is visible in the sidebar with a toggle,
    /// whereas a silently-flipped one is a setting the user cannot trust. Defaults
    /// to true for a caller that says nothing, since `GET /channels/gateway/enabled`
    /// serves only enabled configs and "create a bot for me" plainly asks for a
    /// running bot.
    pub enabled: bool,
}

impl Default for ChannelIntent {
    fn default() -> Self {
        Self {
            name: None,
            channel_id: None,
            agent_id: None,
            team_id: None,
            model: None,
            system_prompt: None,
            group_reply_mode: None,
            proactive_opening: false,
            proactive_target: None,
            enabled: true,
        }
    }
}

/// The PATCH body for an EXISTING config: secrets only. `PATCH` merges secrets, so
/// sending just these three rotates the token without disturbing the bot's name,
/// agent binding, behaviour settings, or the user's own `enabled` choice.
pub fn patch_channel_body(bot_token: &str, claim_secret: &str, nonce: &str) -> Value {
    json!({
        "secrets": {
            "bot_token": bot_token,
            "managed_bot_secret": claim_secret,
            "managed_bot_nonce": nonce,
        }
    })
}

/// Classify a 200 claim body. Anything that is not a known status is an error
/// rather than an optimistic "pending", so a manager/protocol mismatch surfaces
/// instead of turning into an infinite poll.
fn claim_status_from_body(body: &Value) -> Result<ClaimStatus> {
    match body.get("status").and_then(Value::as_str) {
        Some("pending") => Ok(ClaimStatus::Pending),
        Some("ready") => {
            let bot: ManagedBot = serde_json::from_value(body.clone())
                .context("parsing the ready managed-bot payload")?;
            if bot.token.is_empty() {
                bail!("manager reported ready with an empty token");
            }
            Ok(ClaimStatus::Ready(Box::new(bot)))
        }
        // The manager's own third answer, and one the two sides MUST agree on: it
        // means "handed out already", not "gone", and reporting it as an expiry
        // would strand a bot that really exists (see `ClaimStatus::AlreadyClaimed`).
        Some("claimed") => Ok(ClaimStatus::AlreadyClaimed),
        other => bail!(
            "manager returned an unknown claim status {:?}",
            other.unwrap_or("<missing>")
        ),
    }
}

// ── Manager client ───────────────────────────────────────────────────────────

/// Typed client for the manager's managed-bot surface.
#[derive(Clone)]
pub struct ManagerClient {
    base: String,
    http: reqwest::Client,
}

impl ManagerClient {
    /// Build a client from the environment ([`MANAGER_URL_ENV`] → hosted default).
    pub fn from_env() -> Self {
        Self::with_base(manager_base())
    }

    pub fn with_base(base: impl Into<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("building reqwest client");
        Self {
            base: base.into().trim_end_matches('/').to_string(),
            http,
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// Step 1: mint a pairing. The response carries the claim_secret, so nothing
    /// about this response may be logged or echoed.
    pub async fn pair(&self, req: &PairRequest) -> Result<PairSession> {
        let resp = self
            .http
            .post(pair_url(&self.base))
            .json(req)
            .send()
            .await
            .context("POST /managed-bot/pair on the managed-bot manager")?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_IMPLEMENTED
            || status == reqwest::StatusCode::NOT_FOUND
        {
            // The manager answers 501 when Bot Management Mode is off, and 404 when
            // the managed-bot routes are not mounted at all. Both mean "no amount of
            // retrying helps", which is a different answer to the UI than "the
            // manager is having a bad minute" — hence a typed error, not a message.
            return Err(anyhow::Error::new(ManagerUnavailable {
                status: status.as_u16(),
            }));
        }
        if !status.is_success() {
            // Status only. A pair response body contains the claim_secret, and a
            // manager that errors with a partial body would leak it into the log.
            bail!("managed-bot manager POST /managed-bot/pair returned {status}");
        }
        let session: PairSession = resp
            .json()
            .await
            .context("decoding the managed-bot pair response")?;
        validate_nonce(&session.nonce).context("manager returned a malformed nonce")?;
        if session.claim_secret.is_empty() {
            bail!("manager returned an empty claim_secret");
        }
        Ok(session)
    }

    /// Step 6: poll for the token. 404 means unknown/expired and is a normal,
    /// terminal answer — not an error.
    pub async fn claim(&self, nonce: &str, claim_secret: &Secret) -> Result<ClaimStatus> {
        validate_nonce(nonce)?;
        let resp = self
            .http
            .get(claim_url(&self.base, nonce))
            .bearer_auth(claim_secret.expose())
            .send()
            .await
            .context("GET /managed-bot/claim/:nonce on the managed-bot manager")?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(ClaimStatus::Gone);
        }
        // Mid-flow the manager can go dark too (a redeploy with the BotFather switch
        // flipped back off), and the desktop needs the same fall-back-to-manual
        // answer here as it gets on `pair`.
        if status == reqwest::StatusCode::NOT_IMPLEMENTED {
            return Err(anyhow::Error::new(ManagerUnavailable {
                status: status.as_u16(),
            }));
        }
        if !status.is_success() {
            bail!("managed-bot manager claim returned {status}");
        }
        let body: Value = resp.json().await.context("decoding the claim response")?;
        claim_status_from_body(&body)
    }

    /// Step 8 (read): the CURRENT token, re-read from Telegram by the manager.
    ///
    /// This is also the retry lane after a claim succeeded but the local write
    /// failed: the one-shot `claim` will not hand the token over twice, but the
    /// managed-bot record survives, so `refresh` can.
    pub async fn refresh(&self, nonce: &str, claim_secret: &Secret) -> Result<ManagedBot> {
        self.action("refresh", nonce, claim_secret).await
    }

    /// Step 8 (rotate): `replaceManagedBotToken`. Destructive — the old token is
    /// revoked, so the caller MUST land the returned one.
    pub async fn rotate(&self, nonce: &str, claim_secret: &Secret) -> Result<ManagedBot> {
        self.action("rotate", nonce, claim_secret).await
    }

    /// Ryu's delete-my-bot obligation: Telegram gives users no native revocation
    /// UI, so forgetting the managed-bot record has to be reachable from here (and
    /// from `/deletebot` in the manager chat).
    pub async fn delete(&self, nonce: &str, claim_secret: &Secret) -> Result<()> {
        validate_nonce(nonce)?;
        let resp = self
            .http
            .post(action_url(&self.base, "delete"))
            .bearer_auth(claim_secret.expose())
            .json(&action_body(nonce))
            .send()
            .await
            .context("POST /managed-bot/delete on the managed-bot manager")?;
        let status = resp.status();
        // A record that is already gone is the outcome the caller wanted.
        if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        bail!("managed-bot manager delete returned {status}");
    }

    async fn action(&self, action: &str, nonce: &str, claim_secret: &Secret) -> Result<ManagedBot> {
        validate_nonce(nonce)?;
        let resp = self
            .http
            .post(action_url(&self.base, action))
            .bearer_auth(claim_secret.expose())
            .json(&action_body(nonce))
            .send()
            .await
            .with_context(|| format!("POST /managed-bot/{action} on the managed-bot manager"))?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_IMPLEMENTED {
            return Err(anyhow::Error::new(ManagerUnavailable {
                status: status.as_u16(),
            }));
        }
        if !status.is_success() {
            bail!("managed-bot manager {action} returned {status}");
        }
        let body: Value = resp
            .json()
            .await
            .with_context(|| format!("decoding the {action} response"))?;
        match claim_status_from_body(&body)? {
            ClaimStatus::Ready(bot) => Ok(*bot),
            ClaimStatus::Pending => bail!("managed-bot manager {action} answered pending"),
            // `refresh`/`rotate` read the token from Telegram rather than handing out
            // the stored one-shot copy, so neither can honestly answer "claimed".
            ClaimStatus::AlreadyClaimed | ClaimStatus::Gone => {
                bail!("managed-bot manager {action} reports no such managed bot")
            }
        }
    }
}

// ── Pending-pairing store ────────────────────────────────────────────────────

/// Where a pairing has got to. The claimed states exist so a second poll is
/// idempotent: the manager hands the token over exactly once, so re-claiming would
/// 404 and a naive handler would report a successful pairing as expired.
#[derive(Debug, Clone)]
enum PairingState {
    /// The user has not finished creating the bot.
    Waiting,
    /// The manager handed the token over and the node is holding it, unwritten,
    /// until a human confirms the bot is the one THEY just created.
    ///
    /// This state exists because the nonce is public by design: it rides a QR the
    /// user may hold up to a camera, so whoever opens the deep link FIRST binds the
    /// pairing. Without a confirmation step, someone who reads the nonce off a
    /// screen share can create a bot they own and have this node adopt it —
    /// handing them a live credential inside the user's chats. Only the person at
    /// the desktop can tell "@the_bot_I_just_made" from a stranger's, so the token
    /// waits here for them to say so.
    AwaitingConfirmation { bot: Box<ManagedBot> },
    /// Token claimed AND written. Terminal success; later polls answer from here
    /// and make no network call and no second write.
    Landed {
        channel_id: String,
        bot_id: i64,
        bot_username: String,
    },
    /// The one-shot claim is spent but the token is not in a channel config yet —
    /// the local write failed, or the claim's HTTP response was lost in flight and
    /// the manager answered `claimed` on the retry. Either way the recovery is
    /// `refresh`, never a second claim. Carries nothing: the refresh answer names
    /// the bot, so remembering a stale copy here would only invite reading it.
    Unlanded,
}

#[derive(Debug, Clone)]
struct Pending {
    claim_secret: Secret,
    /// The add-channel form, held until the poll can write it (see
    /// [`ChannelIntent`]).
    intent: ChannelIntent,
    /// Local expiry: `min(manager expires_at, now + PAIRING_MAX_TTL_MS)`.
    expires_at_ms: i64,
    /// RFC3339 string echoed to clients.
    expires_at: String,
    deep_link: String,
    last_polled_ms: i64,
    state: PairingState,
}

/// Pending pairings, keyed by nonce.
///
/// A value rather than a bare static so the map is not process-global state every
/// caller shares: [`PendingStore::remember`] evicts expired entries, and with one
/// global map any caller working from a different clock base evicts the others'
/// rows. In production every caller passes [`now_ms`], so that could only ever bite
/// tests — which it did, three of them, but only under the parallel runner, which is
/// the worst possible way to learn it. The node keeps exactly one instance
/// ([`pending`]); a test owns its own.
#[derive(Default)]
pub struct PendingStore {
    map: Mutex<HashMap<String, Pending>>,
}

/// The node's single store.
///
/// Process-local on purpose. The claim_secret must never leave the node, and a
/// pairing is a 10-minute interaction, so persisting it would add a secret at rest
/// to protect a window shorter than most restarts. The cost is explicit: a Core
/// restart mid-pairing loses the claim_secret and the user re-pairs. Once the claim
/// SUCCEEDS the secret is re-persisted into the channel config's sealed `secrets`
/// map, so rotation — the part that must outlive a restart — does.
static PENDING: OnceLock<PendingStore> = OnceLock::new();

fn pending() -> &'static PendingStore {
    PENDING.get_or_init(PendingStore::default)
}

/// Current wall clock in Unix milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Parse the manager's RFC3339 expiry and clamp it to the local ceiling. An
/// unparseable expiry falls back to the ceiling rather than rejecting the pairing:
/// the ceiling is what makes an entry unusable, and the string is only cosmetic.
fn effective_expiry_ms(expires_at: &str, now_ms: i64) -> i64 {
    let ceiling = now_ms.saturating_add(PAIRING_MAX_TTL_MS);
    match chrono::DateTime::parse_from_rfc3339(expires_at.trim()) {
        Ok(dt) => dt.timestamp_millis().min(ceiling),
        Err(_) => ceiling,
    }
}

/// Record a freshly-minted pairing on the node's store.
pub fn remember(session: &PairSession, intent: ChannelIntent, now: i64) -> Result<()> {
    pending().remember(session, intent, now)
}

/// What the poll handler should do next.
#[derive(Debug)]
pub enum PollDecision {
    /// No such pairing, or it expired and was dropped. Expiry is enforced here on
    /// every read, so an expired row is unusable rather than merely un-listed.
    Unknown,
    /// Polled too recently — answer `waiting` without touching the manager.
    Throttled,
    /// Ask the manager. `use_refresh` is true when a previous claim already spent
    /// the one-shot token and the local write is what failed.
    ///
    /// No [`ChannelIntent`] rides along: the form is not needed until a human
    /// confirms the bot, and [`PendingStore::take_confirmed`] hands it over then.
    AskManager {
        claim_secret: Secret,
        use_refresh: bool,
    },
    /// The token is in hand but unwritten: a human must confirm this is the bot
    /// they created before it becomes their assistant's identity. Answered from
    /// local state, so re-polling neither re-claims nor lands anything.
    NeedsConfirmation(ConfirmationView),
    /// Already confirmed AND landed. Terminal — the idempotent re-claim answer.
    Landed {
        channel_id: String,
        bot_id: i64,
        bot_username: String,
    },
}

/// Decide what a poll for `nonce` should do on the node's store.
pub fn begin_poll(nonce: &str, now: i64) -> PollDecision {
    pending().begin_poll(nonce, now)
}

/// Hold a claimed token for the human's yes/no. Returns what the desktop must show
/// them, or `None` if the pairing vanished under us.
pub fn hold_for_confirmation(nonce: &str, bot: ManagedBot) -> Option<ConfirmationView> {
    pending().hold_for_confirmation(nonce, bot)
}

/// The human said yes: hand back everything needed to write the config.
pub fn take_confirmed(nonce: &str) -> Option<(ManagedBot, Secret, ChannelIntent)> {
    pending().take_confirmed(nonce)
}

/// The human said no (or cancelled): drop the pairing and hand back the secret so
/// the caller can tell the manager to forget — and revoke — the bot too.
///
/// `None` for a pairing that already LANDED, which is not a cancel but a stale one:
/// forgetting a landed record on the manager revokes the token now sealed in the
/// channel config, and the config would be permanently dead.
pub fn take_for_cancel(nonce: &str) -> Option<Secret> {
    pending().take_for_cancel(nonce)
}

/// Terminal success: the token is in the channel config.
pub fn mark_landed(nonce: &str, channel_id: &str, bot_id: i64, bot_username: &str) {
    pending().mark_landed(nonce, channel_id, bot_id, bot_username);
}

/// The one-shot claim is spent and the token has not landed. Route the next poll
/// through `refresh` rather than re-claiming a token the manager will not resend.
pub fn mark_unlanded(nonce: &str) {
    pending().mark_unlanded(nonce);
}

/// Drop a pairing (the manager says it is gone, or the user cancelled).
pub fn forget(nonce: &str) {
    pending().forget(nonce);
}

/// The client-safe view of a pending pairing: nonce, deep link, expiry — never the
/// claim_secret.
pub fn public_view(nonce: &str) -> Option<(String, String)> {
    pending().public_view(nonce)
}

impl PendingStore {
    /// Record a freshly-minted pairing. Also drops every already-expired entry, so
    /// the map cannot grow with dead secrets on a node that pairs repeatedly.
    pub fn remember(&self, session: &PairSession, intent: ChannelIntent, now: i64) -> Result<()> {
        validate_nonce(&session.nonce)?;
        let entry = Pending {
            claim_secret: session.claim_secret.clone(),
            intent,
            expires_at_ms: effective_expiry_ms(&session.expires_at, now),
            expires_at: session.expires_at.clone(),
            deep_link: session.deep_link.clone(),
            // Zero, not `now`: the desktop polls immediately after begin and that
            // first poll must reach the manager.
            last_polled_ms: 0,
            state: PairingState::Waiting,
        };
        let mut map = self
            .map
            .lock()
            .map_err(|_| anyhow!("managed-bot pending map poisoned"))?;
        map.retain(|_, p| p.expires_at_ms > now || matches!(p.state, PairingState::Landed { .. }));
        map.insert(session.nonce.clone(), entry);
        Ok(())
    }

    /// Decide what a poll for `nonce` should do, stamping the throttle clock.
    ///
    /// A `Landed` pairing is answered without stamping: it never calls out again,
    /// and keeping the clock untouched means a client that polls a finished pairing
    /// forever still reads the same terminal answer.
    pub fn begin_poll(&self, nonce: &str, now: i64) -> PollDecision {
        let Ok(mut map) = self.map.lock() else {
            return PollDecision::Unknown;
        };
        let Some(entry) = map.get_mut(nonce) else {
            return PollDecision::Unknown;
        };
        if let PairingState::Landed {
            channel_id,
            bot_id,
            bot_username,
        } = &entry.state
        {
            return PollDecision::Landed {
                channel_id: channel_id.clone(),
                bot_id: *bot_id,
                bot_username: bot_username.clone(),
            };
        }
        // Held for confirmation: no expiry check and no throttle stamp. The bot
        // EXISTS by now, so timing the user out here would leave them owning a bot
        // Telegram gives them no way to delete — the decision has to stay open.
        if let PairingState::AwaitingConfirmation { bot } = &entry.state {
            return PollDecision::NeedsConfirmation(ConfirmationView::of(bot));
        }
        if entry.expires_at_ms <= now {
            map.remove(nonce);
            return PollDecision::Unknown;
        }
        if now.saturating_sub(entry.last_polled_ms) < MIN_POLL_INTERVAL_MS {
            return PollDecision::Throttled;
        }
        entry.last_polled_ms = now;
        PollDecision::AskManager {
            claim_secret: entry.claim_secret.clone(),
            use_refresh: matches!(entry.state, PairingState::Unlanded),
        }
    }

    /// Park a claimed token in [`PairingState::AwaitingConfirmation`].
    pub fn hold_for_confirmation(&self, nonce: &str, bot: ManagedBot) -> Option<ConfirmationView> {
        let mut map = self.map.lock().ok()?;
        let entry = map.get_mut(nonce)?;
        let view = ConfirmationView::of(&bot);
        entry.state = PairingState::AwaitingConfirmation { bot: Box::new(bot) };
        Some(view)
    }

    /// Take a confirmed token out for writing. Leaves the entry in place (still
    /// `AwaitingConfirmation`) so a failed write can be retried by confirming
    /// again; `mark_landed` is what makes the success terminal.
    pub fn take_confirmed(&self, nonce: &str) -> Option<(ManagedBot, Secret, ChannelIntent)> {
        let map = self.map.lock().ok()?;
        let entry = map.get(nonce)?;
        let PairingState::AwaitingConfirmation { bot } = &entry.state else {
            return None;
        };
        Some((
            (**bot).clone(),
            entry.claim_secret.clone(),
            entry.intent.clone(),
        ))
    }

    /// Drop the pairing and return its claim_secret, so the caller can tell the
    /// manager to forget the record. A user may cancel before the bot exists and may
    /// refuse one that already does — but NOT one that already landed.
    ///
    /// That exclusion is the whole reason this is a state-aware take. Cancelling on
    /// the manager revokes the bot's token, and once a pairing has landed that token
    /// is sealed in a channel config the gateway is running: revoking it leaves a
    /// channel that 401s forever with no refresh path. It is reachable by accident,
    /// not just by a confused user — a confirm whose response is lost looks exactly
    /// like an unfinished pairing to the client that retried it.
    pub fn take_for_cancel(&self, nonce: &str) -> Option<Secret> {
        let mut map = self.map.lock().ok()?;
        if matches!(map.get(nonce)?.state, PairingState::Landed { .. }) {
            return None;
        }
        let entry = map.remove(nonce)?;
        Some(entry.claim_secret)
    }

    pub fn mark_landed(&self, nonce: &str, channel_id: &str, bot_id: i64, bot_username: &str) {
        if let Ok(mut map) = self.map.lock() {
            if let Some(entry) = map.get_mut(nonce) {
                entry.state = PairingState::Landed {
                    channel_id: channel_id.to_string(),
                    bot_id,
                    bot_username: bot_username.to_string(),
                };
            }
        }
    }

    pub fn mark_unlanded(&self, nonce: &str) {
        if let Ok(mut map) = self.map.lock() {
            if let Some(entry) = map.get_mut(nonce) {
                entry.state = PairingState::Unlanded;
            }
        }
    }

    pub fn forget(&self, nonce: &str) {
        if let Ok(mut map) = self.map.lock() {
            map.remove(nonce);
        }
    }

    pub fn public_view(&self, nonce: &str) -> Option<(String, String)> {
        let map = self.map.lock().ok()?;
        let entry = map.get(nonce)?;
        Some((entry.deep_link.clone(), entry.expires_at.clone()))
    }
}

// ── Landing the token where a hand-pasted one lands ──────────────────────────

/// Write a managed token into the channel config the gateway already reads.
///
/// Creates when `channel_id` is `None`, otherwise PATCHes — the control plane's own
/// `POST /api/channels` / `PATCH /api/channels/:id`, with the signed-in device
/// account's bearer, so there is exactly ONE channel-config writer and one place
/// that seals the secrets. Returns the config id.
///
/// Unlike the manager calls, a non-2xx control-plane body IS included in the error:
/// that response is a masked config or a validation message and never carries a
/// secret, and its text ("missing required secrets for telegram: …") is the only
/// way to debug a rejected write.
pub async fn land_token(
    bot: &ManagedBot,
    nonce: &str,
    claim_secret: &Secret,
    intent: &ChannelIntent,
) -> Result<String> {
    let token = crate::auth::load_token()
        .ok_or_else(|| anyhow!("no signed-in account — complete device login before pairing"))?;
    let base = control_plane_base();
    let http = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .context("building reqwest client")?;

    let (url, body, method_patch) = match intent.channel_id.as_deref() {
        Some(id) => (
            format!("{base}/api/channels/{id}"),
            patch_channel_body(bot.token.expose(), claim_secret.expose(), nonce),
            true,
        ),
        None => (
            format!("{base}/api/channels"),
            create_channel_body(
                &channel_name(intent.name.as_deref(), &bot.bot_username, bot.bot_id),
                bot.token.expose(),
                claim_secret.expose(),
                nonce,
                intent,
            ),
            false,
        ),
    };

    let req = if method_patch {
        http.patch(&url)
    } else {
        http.post(&url)
    };
    let resp = req
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .context("writing the managed bot token to the channel config")?;
    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        bail!("control plane channel write returned {status}: {detail}");
    }
    let saved: Value = resp
        .json()
        .await
        .context("decoding the saved channel config")?;
    let id = saved
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("control plane channel write returned no id"))?;
    Ok(id.to_string())
}

/// Name for a newly-created config. The control plane requires a non-empty name,
/// and the name is not known when the pairing starts (the bot does not exist yet),
/// so the bot's own username is the fallback — with the numeric id as a last resort
/// for a manager that omitted the username.
pub fn channel_name(requested: Option<&str>, bot_username: &str, bot_id: i64) -> String {
    if let Some(name) = requested.map(str::trim).filter(|n| !n.is_empty()) {
        return name.to_string();
    }
    let handle = bot_username.trim();
    if handle.is_empty() {
        format!("Telegram bot {bot_id}")
    } else {
        format!("@{}", handle.trim_start_matches('@'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "0123456789abcdef0123456789abcdef";

    fn session(nonce: &str, expires_at: &str) -> PairSession {
        PairSession {
            nonce: nonce.to_string(),
            claim_secret: Secret::new("s3cr3t-claim-secret-0123456789ab"),
            deep_link: "https://t.me/ryu_bot?start=mb_x".to_string(),
            expires_at: expires_at.to_string(),
        }
    }

    // ── URL / body construction ──────────────────────────────────────────────

    #[test]
    fn manager_urls_hang_off_the_base_without_doubling_slashes() {
        assert_eq!(
            pair_url("https://bot.ryuhq.com/"),
            "https://bot.ryuhq.com/managed-bot/pair"
        );
        assert_eq!(
            claim_url("https://bot.ryuhq.com", NONCE),
            format!("https://bot.ryuhq.com/managed-bot/claim/{NONCE}")
        );
        assert_eq!(
            action_url("http://127.0.0.1:4001/", "rotate"),
            "http://127.0.0.1:4001/managed-bot/rotate"
        );
        assert_eq!(action_body(NONCE), json!({ "nonce": NONCE }));
    }

    #[test]
    fn manager_base_defaults_to_the_hosted_service() {
        // The env var is process-global and other tests must not see it set, so
        // assert the default shape rather than mutating the environment.
        assert_eq!(DEFAULT_MANAGER_BASE, "https://bot.ryuhq.com");
        assert!(!manager_base().ends_with('/'));
    }

    #[test]
    fn client_trims_a_trailing_slash_from_the_configured_base() {
        let client = ManagerClient::with_base("https://bot.example.com/");
        assert_eq!(client.base(), "https://bot.example.com");
    }

    #[test]
    fn nonce_charset_is_enforced_so_a_poll_cannot_walk_the_claim_path() {
        assert!(validate_nonce(NONCE).is_ok());
        assert!(validate_nonce("short").is_err());
        // Path traversal, a nested path, and a query splice all rejected.
        assert!(validate_nonce("../../managed-bot/pair/aaaaaaaaaaaaaaaa").is_err());
        assert!(validate_nonce("abcdefghijklmnop/../secret").is_err());
        assert!(validate_nonce("abcdefghijklmnop?x=1").is_err());
        assert!(validate_nonce(&"a".repeat(NONCE_MAX_LEN + 1)).is_err());
    }

    #[test]
    fn create_body_lands_the_token_where_the_adapter_reads_it_and_enables_the_bot() {
        let intent = ChannelIntent {
            agent_id: Some("ryu".into()),
            ..ChannelIntent::default()
        };
        let body = create_channel_body("My bot", "123:ABC", "claim", NONCE, &intent);
        assert_eq!(body["channelType"], "telegram");
        assert_eq!(body["name"], "My bot");
        // Without this the token is stored and nothing ever spawns the adapter.
        assert_eq!(body["enabled"], true);
        assert_eq!(body["secrets"]["bot_token"], "123:ABC");
        assert_eq!(body["secrets"]["managed_bot_secret"], "claim");
        assert_eq!(body["secrets"]["managed_bot_nonce"], NONCE);
        assert_eq!(body["agentId"], "ryu");

        // A blank agent id is omitted rather than sent as "".
        let blank = ChannelIntent {
            agent_id: Some("  ".into()),
            ..ChannelIntent::default()
        };
        let body = create_channel_body("My bot", "123:ABC", "claim", NONCE, &blank);
        assert!(body.get("agentId").is_none());
    }

    /// Every field the add-channel form can set has to survive the pairing, because
    /// the config is written minutes later by a poll. Each of these was silently
    /// dropped once: the bot came out named after its handle, bound to no agent,
    /// with the default reply mode, and enabled against the user's choice.
    #[test]
    fn the_create_body_carries_the_whole_form_not_just_the_token() {
        let intent = ChannelIntent {
            name: Some("Support bot".into()),
            channel_id: None,
            agent_id: None,
            team_id: Some("team-7".into()),
            model: Some("sonnet".into()),
            system_prompt: Some("Be brief.".into()),
            group_reply_mode: Some("mentions".into()),
            proactive_opening: true,
            proactive_target: Some("123456".into()),
            enabled: false,
        };
        let body = create_channel_body("Support bot", "123:ABC", "claim", NONCE, &intent);
        assert_eq!(body["teamId"], "team-7");
        assert_eq!(body["model"], "sonnet");
        assert_eq!(body["systemPrompt"], "Be brief.");
        assert_eq!(body["groupReplyMode"], "mentions");
        assert_eq!(body["proactiveOpening"], true);
        assert_eq!(body["proactiveTarget"], "123456");
        // The user's own switch, not a forced `true`: the control plane reads
        // `body.enabled === true`, so this field must always be present.
        assert_eq!(body["enabled"], false);
        // An unset binding is absent rather than null, so the control plane applies
        // its own default instead of storing an empty string.
        assert!(body.get("agentId").is_none());
    }

    #[test]
    fn patch_body_carries_only_secrets_so_it_cannot_clobber_the_users_settings() {
        let body = patch_channel_body("123:ABC", "claim", NONCE);
        let obj = body.as_object().expect("object body");
        assert_eq!(obj.len(), 1, "PATCH must send secrets and nothing else");
        assert_eq!(body["secrets"]["bot_token"], "123:ABC");
        // Notably absent: `enabled`. The user's own choice on an existing config
        // must survive a token rotation.
        assert!(body["secrets"].get("enabled").is_none());
    }

    #[test]
    fn channel_name_falls_back_to_the_bot_handle_then_its_id() {
        assert_eq!(channel_name(Some("Helper"), "helper_bot", 7), "Helper");
        assert_eq!(channel_name(Some("  "), "helper_bot", 7), "@helper_bot");
        assert_eq!(channel_name(None, "@helper_bot", 7), "@helper_bot");
        assert_eq!(channel_name(None, "  ", 7), "Telegram bot 7");
    }

    // ── Secret hygiene ───────────────────────────────────────────────────────

    #[test]
    fn secrets_are_redacted_in_debug_and_never_reach_a_serialized_body() {
        let s = session(NONCE, "2026-08-06T12:00:00Z");
        let dumped = format!("{s:?}");
        assert!(
            !dumped.contains("s3cr3t-claim-secret"),
            "Debug leaked the claim_secret: {dumped}"
        );
        assert!(dumped.contains("[redacted]"), "expected a placeholder");
        // The nonce and deep link ARE public and must still be debuggable.
        assert!(dumped.contains(NONCE));

        let bot = ManagedBot {
            token: Secret::new("123456:AA-live-bot-token"),
            bot_id: 999,
            bot_username: "helper_bot".into(),
            owner_telegram_user_id: Some(111),
        };
        let dumped = format!("{bot:?}");
        assert!(
            !dumped.contains("live-bot-token"),
            "Debug leaked the bot token: {dumped}"
        );
        assert!(dumped.contains("999"), "public ids stay loggable");

        // `Secret` implements neither Serialize nor Display, so the only route out
        // is `expose()`. Guard the property the response path depends on: the
        // client-facing pairing view carries no secret material.
        let store = PendingStore::default();
        store
            .remember(&s, ChannelIntent::default(), now_ms())
            .expect("remember");
        let (deep_link, expires_at) = store.public_view(NONCE).expect("view");
        let view = json!({ "nonce": NONCE, "deep_link": deep_link, "expires_at": expires_at });
        let encoded = serde_json::to_string(&view).expect("serialize");
        assert!(!encoded.contains("s3cr3t-claim-secret"));
    }

    // ── Claim status mapping ─────────────────────────────────────────────────

    #[test]
    fn claim_status_maps_pending_ready_and_unknown() {
        assert!(matches!(
            claim_status_from_body(&json!({ "status": "pending" })).unwrap(),
            ClaimStatus::Pending
        ));

        let ready = claim_status_from_body(&json!({
            "status": "ready",
            "token": "123456:AA",
            "bot_id": 999,
            "bot_username": "helper_bot",
            "owner_telegram_user_id": 111,
        }))
        .unwrap();
        match ready {
            ClaimStatus::Ready(bot) => {
                assert_eq!(bot.bot_id, 999);
                assert_eq!(bot.bot_username, "helper_bot");
                assert_eq!(bot.token.expose(), "123456:AA");
                assert_eq!(bot.owner_telegram_user_id, Some(111));
            }
            other => panic!("expected ready, got {other:?}"),
        }

        // `claimed` is the manager's third answer and the one a lost claim response
        // produces on retry. It is NOT an expiry: the record survives, so the token
        // is still reachable through `refresh`.
        assert!(matches!(
            claim_status_from_body(&json!({ "status": "claimed" })).unwrap(),
            ClaimStatus::AlreadyClaimed
        ));

        // The vocabularies are identical on both sides on purpose: the manager
        // signals an unknown/expired pairing with a 404, never a 200 body, so
        // `expired`/`gone` are not statuses this client accepts.
        assert!(claim_status_from_body(&json!({ "status": "expired" })).is_err());

        // A ready with no token is a protocol bug, not a pairing to celebrate.
        assert!(claim_status_from_body(&json!({ "status": "ready", "bot_id": 1 })).is_err());
        // An unknown status must NOT degrade to "pending" — that is an infinite poll.
        assert!(claim_status_from_body(&json!({ "status": "banana" })).is_err());
        assert!(claim_status_from_body(&json!({})).is_err());
    }

    // ── Pending store state machine ──────────────────────────────────────────

    #[test]
    fn poll_throttles_then_asks_the_manager() {
        let nonce = "throttle0123456789abcdef01234567";
        let now = 1_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent::default(),
                now,
            )
            .unwrap();

        // First poll always reaches the manager.
        assert!(matches!(
            store.begin_poll(nonce, now),
            PollDecision::AskManager { .. }
        ));
        // Immediately again: answered locally.
        assert!(matches!(
            store.begin_poll(nonce, now + 10),
            PollDecision::Throttled
        ));
        // After the floor: upstream again.
        assert!(matches!(
            store.begin_poll(nonce, now + MIN_POLL_INTERVAL_MS),
            PollDecision::AskManager { .. }
        ));
    }

    #[test]
    fn an_expired_pairing_is_dropped_and_unusable_not_merely_hidden() {
        let nonce = "expiry00123456789abcdef012345678";
        let now = 1_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent::default(),
                now,
            )
            .unwrap();

        // The local ceiling bounds the entry even if the manager's expiry is far off.
        assert!(matches!(
            store.begin_poll(nonce, now + PAIRING_MAX_TTL_MS + 1),
            PollDecision::Unknown
        ));
        // And the row is GONE, so a later in-window poll cannot resurrect it.
        assert!(matches!(
            store.begin_poll(nonce, now + 1),
            PollDecision::Unknown
        ));
    }

    #[test]
    fn a_manager_expiry_inside_the_ceiling_wins() {
        let now = 1_700_000_000_000;
        // 2033 — far beyond the ceiling, so the ceiling applies.
        assert_eq!(
            effective_expiry_ms("2033-01-01T00:00:00Z", now),
            now + PAIRING_MAX_TTL_MS
        );
        // An unparseable expiry also falls back to the ceiling rather than
        // rejecting the pairing.
        assert_eq!(
            effective_expiry_ms("not a date", now),
            now + PAIRING_MAX_TTL_MS
        );
        // A short manager expiry is honoured verbatim.
        let soon = chrono::DateTime::from_timestamp_millis(now + 60_000)
            .expect("timestamp")
            .to_rfc3339();
        assert_eq!(effective_expiry_ms(&soon, now), now + 60_000);
    }

    #[test]
    fn re_claim_is_idempotent_once_the_token_has_landed() {
        let nonce = "landed00123456789abcdef012345678";
        let now = 2_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent::default(),
                now,
            )
            .unwrap();
        store.mark_landed(nonce, "chan-1", 999, "helper_bot");

        // Every later poll answers from local state: no second claim, no second
        // write, and no "expired" once the manager's one-shot token is spent.
        for step in [0, 1, MIN_POLL_INTERVAL_MS * 10] {
            match store.begin_poll(nonce, now + step) {
                PollDecision::Landed {
                    channel_id,
                    bot_id,
                    bot_username,
                } => {
                    assert_eq!(channel_id, "chan-1");
                    assert_eq!(bot_id, 999);
                    assert_eq!(bot_username, "helper_bot");
                }
                other => panic!("expected landed, got {other:?}"),
            }
        }
        // A landed pairing survives its own expiry window: the desktop may poll
        // after the pairing TTL and must still be told it succeeded.
        assert!(matches!(
            store.begin_poll(nonce, now + PAIRING_MAX_TTL_MS + 1),
            PollDecision::Landed { .. }
        ));
    }

    #[test]
    fn a_failed_write_retries_through_refresh_not_a_spent_claim() {
        let nonce = "unland00123456789abcdef012345678";
        let now = 3_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent {
                    name: Some("My bot".into()),
                    channel_id: Some("chan-9".into()),
                    ..ChannelIntent::default()
                },
                now,
            )
            .unwrap();
        store.mark_unlanded(nonce);

        match store.begin_poll(nonce, now + MIN_POLL_INTERVAL_MS) {
            PollDecision::AskManager {
                use_refresh,
                claim_secret,
            } => {
                assert!(use_refresh, "a spent claim must retry via refresh");
                assert_eq!(claim_secret.expose(), "s3cr3t-claim-secret-0123456789ab");
            }
            other => panic!("expected AskManager, got {other:?}"),
        }

        // And the form the user filled in is still there for the write that follows.
        store.hold_for_confirmation(
            nonce,
            ManagedBot {
                token: Secret::new("555555:AA-refreshed"),
                bot_id: 555,
                bot_username: "helper_bot".into(),
                owner_telegram_user_id: None,
            },
        );
        let (_, _, intent) = store.take_confirmed(nonce).expect("confirmed");
        assert_eq!(intent.name.as_deref(), Some("My bot"));
        assert_eq!(intent.channel_id.as_deref(), Some("chan-9"));
    }

    /// The hijack guard, as a state-machine assertion: a claimed token does not
    /// become a channel config on its own. Whoever opens the public deep link first
    /// binds the pairing, so without this hop a stranger who read the nonce off a
    /// screen share could have this node adopt a bot THEY own.
    #[test]
    fn a_claimed_token_waits_for_a_human_before_it_lands() {
        let nonce = "confirm0123456789abcdef012345678";
        let now = 4_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent {
                    name: Some("Support bot".into()),
                    agent_id: Some("triage".into()),
                    ..ChannelIntent::default()
                },
                now,
            )
            .unwrap();

        let view = store
            .hold_for_confirmation(
                nonce,
                ManagedBot {
                    token: Secret::new("555555:AA-fresh"),
                    bot_id: 555,
                    bot_username: "made_bot".into(),
                    owner_telegram_user_id: Some(4242),
                },
            )
            .expect("held for confirmation");
        assert_eq!(view.bot_id, 555);
        // The field the human decides on: an owner that is not them means the
        // pairing was taken by someone else.
        assert_eq!(view.owner_telegram_user_id, Some(4242));

        // Every later poll answers from local state — no second claim, no write —
        // and the decision does NOT time out: the bot already exists, and Telegram
        // gives its owner no way to delete it.
        for step in [0, MIN_POLL_INTERVAL_MS * 10, PAIRING_MAX_TTL_MS + 1] {
            match store.begin_poll(nonce, now + step) {
                PollDecision::NeedsConfirmation(view) => {
                    assert_eq!(view.bot_username, "made_bot");
                }
                other => panic!("expected NeedsConfirmation, got {other:?}"),
            }
        }

        // The yes hands back the token AND the form the user filled in.
        let (bot, secret, intent) = store.take_confirmed(nonce).expect("confirmed");
        assert_eq!(bot.token.expose(), "555555:AA-fresh");
        assert_eq!(intent.name.as_deref(), Some("Support bot"));
        assert_eq!(intent.agent_id.as_deref(), Some("triage"));
        assert_eq!(secret.expose(), "s3cr3t-claim-secret-0123456789ab");
    }

    #[test]
    fn a_refused_bot_is_dropped_and_hands_back_the_secret_that_revokes_it() {
        let nonce = "refused0123456789abcdef012345678";
        let now = 5_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent::default(),
                now,
            )
            .unwrap();
        store.hold_for_confirmation(
            nonce,
            ManagedBot {
                token: Secret::new("555555:AA-not-mine"),
                bot_id: 555,
                bot_username: "stranger_bot".into(),
                owner_telegram_user_id: Some(9),
            },
        );

        // The secret comes back because the caller needs it to tell the manager to
        // forget — and revoke — the bot; the token itself never goes anywhere.
        let secret = store.take_for_cancel(nonce).expect("claim secret");
        assert_eq!(secret.expose(), "s3cr3t-claim-secret-0123456789ab");
        assert!(store.take_confirmed(nonce).is_none());
        assert!(matches!(
            store.begin_poll(nonce, now),
            PollDecision::Unknown
        ));
        // Nothing left to cancel twice.
        assert!(store.take_for_cancel(nonce).is_none());
    }

    /// A landed pairing must NOT be cancellable: cancelling revokes the token on the
    /// manager, and by then that token is sealed in a channel config the gateway is
    /// running — revoking it leaves a channel that 401s forever.
    #[test]
    fn a_landed_pairing_cannot_be_cancelled_into_a_dead_channel() {
        let nonce = "landcxl0123456789abcdef012345678";
        let now = 6_000_000;
        let store = PendingStore::default();
        store
            .remember(
                &session(nonce, "2026-08-06T12:00:00Z"),
                ChannelIntent::default(),
                now,
            )
            .unwrap();
        store.mark_landed(nonce, "chan-1", 555, "made_bot");

        // A confirm whose response was lost looks exactly like an unfinished pairing
        // to the client that retried it, so this arrives without anyone being confused.
        assert!(store.take_for_cancel(nonce).is_none());
        assert!(matches!(
            store.begin_poll(nonce, now),
            PollDecision::Landed { .. }
        ));
    }

    #[test]
    fn a_manager_with_bot_management_off_is_a_typed_unavailable() {
        // The distinction the UI depends on: "flip a switch in @BotFather" must not
        // arrive as the same generic failure as "the manager had a bad minute", or
        // the desktop shows a Try-again button for something retrying cannot fix.
        let err = anyhow::Error::new(ManagerUnavailable { status: 501 })
            .context("POST /managed-bot/pair on the managed-bot manager");
        assert!(is_manager_unavailable(&err));
        assert!(!is_manager_unavailable(&anyhow!("connection reset")));
    }

    #[test]
    fn an_unknown_nonce_is_unknown_and_a_malformed_one_is_never_stored() {
        let store = PendingStore::default();
        assert!(matches!(
            store.begin_poll("nosuchnonce0123456789abcdef01234", now_ms()),
            PollDecision::Unknown
        ));
        let bad = session("../etc/passwd", "2026-08-06T12:00:00Z");
        assert!(store
            .remember(&bad, ChannelIntent::default(), now_ms())
            .is_err());
        assert!(matches!(
            store.begin_poll("../etc/passwd", now_ms()),
            PollDecision::Unknown
        ));
    }
}
