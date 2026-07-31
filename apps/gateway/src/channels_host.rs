//! Gateway-side channel wiring: the [`ChannelHost`] implementation (the
//! `pipeline::run` call + [`RequestContext`] construction) plus channel
//! registration — control-plane store fetch, env fallback, and spawn.
//!
//! The transport adapters (Telegram/Slack/Discord/WhatsApp/BlueBubbles) and the
//! shared inbound path live in the [`ryu_gw_channels`] crate. This module is the
//! "wiring stays" half of that extraction: it holds everything that touches
//! [`SharedState`], the pipeline, or the gateway config shell, and hands the
//! crate a narrow [`ChannelHost`] seam plus fully-built adapters.
//!
//! One thing is deliberately built HERE rather than per adapter: the
//! [`PairingStore`]. Approving a sender is a per-node act, so every channel on
//! the node must observe the same approvals the moment they land — one store is
//! constructed at startup and cloned into each adapter.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use tracing::{info, warn};
use uuid::Uuid;

use ryu_gw_channels::{
    bluebubbles::BlueBubblesChannel,
    discord::DiscordChannel,
    media::VoiceReplyMode as ChannelVoiceReplyMode,
    pairing::{AccessPolicy, PairingStore},
    policy_from_env,
    slack::SlackChannel,
    spawn_channel,
    status::StatusReporter,
    telegram::TelegramChannel,
    whatsapp::WhatsAppChannel,
    BotProfile, ChannelHost, CommonChannelConfig,
};

use crate::{
    config::{
        BlueBubblesChannelConfig, CommonChannelFileConfig, DiscordChannelConfig,
        SlackChannelConfig, TelegramChannelConfig, VoiceReplyMode, WhatsAppChannelConfig,
    },
    pipeline::{self, RequestContext},
    state::SharedState,
};

/// Default model used for store-sourced bot configs that don't specify one.
const DEFAULT_BOT_MODEL: &str = "gpt-4o";

/// Override for the pairing store's location. Mirrors the escape hatch the
/// marketplace signing key has, for deployments that keep gateway state on a
/// mounted volume.
const ENV_PAIRING_PATH: &str = "RYU_CHANNEL_PAIRING_PATH";

// ─── Gateway config → crate transport-config mapping ────────────────────────
//
// The config-FILE shapes live in `config.rs` (serde + profile-aware `core_url`
// defaults, kernel §5). The transport adapters take the crate's plain config
// mirrors; these move the fields across at the spawn boundary. Everything that
// is not a transport secret now lives in one `common` struct on both sides, so
// each mapper is its secrets plus one `to_common` call.

/// Map the config-file voice mode onto the crate's domain enum. Two enums exist
/// because the config shape is serde-aware and the crate's is not; the variants
/// are 1:1 so this stays exhaustive by construction.
fn to_voice_reply(mode: VoiceReplyMode) -> ChannelVoiceReplyMode {
    match mode {
        VoiceReplyMode::Never => ChannelVoiceReplyMode::Never,
        VoiceReplyMode::Mirror => ChannelVoiceReplyMode::Mirror,
        VoiceReplyMode::Always => ChannelVoiceReplyMode::Always,
    }
}

/// Resolve a channel's [`AccessPolicy`] from the config file, layered over the
/// legacy env allowlist.
///
/// The env vars (`RYU_CHANNEL_ALLOWED_USERS[_<PLATFORM>]`, `RYU_CHANNEL_ALLOW_ALL`)
/// are the baseline, so a deployment that configures nothing new keeps exactly
/// the gate it has today. An explicitly configured policy or allowlist then
/// overrides that baseline — but an env allowlist survives an explicit policy
/// change, which is what lets a bot switch to pairing without locking out the
/// senders the operator had already admitted.
fn to_access_policy(platform: &str, c: &CommonChannelFileConfig) -> AccessPolicy {
    let mut policy = policy_from_env(platform);
    if let Some(dm) = c.dm_policy {
        policy.dm = dm;
    }
    if let Some(group) = c.group_policy {
        policy.group = group;
    }
    if !c.dm_allowlist.is_empty() {
        policy.dm_allowlist = c.dm_allowlist.clone();
    }
    if !c.group_allowlist.is_empty() {
        policy.group_allowlist = c.group_allowlist.clone();
    }
    policy
}

/// Map the shared config-file knobs onto the crate's [`CommonChannelConfig`].
///
/// `send_read_receipts` is the one field this does NOT resolve: the kernel keeps
/// it in the common struct (that is where `handle_turn` reads it), but only two
/// platforms can act on it, so only those two configs expose the key. They set it
/// on the returned struct; everyone else keeps the kernel's default, where
/// `mark_read` is a no-op anyway.
fn to_common(platform: &str, c: CommonChannelFileConfig) -> CommonChannelConfig {
    let access = to_access_policy(platform, &c);
    CommonChannelConfig {
        model: c.model,
        system_prompt: c.system_prompt,
        agent_id: c.agent_id,
        team_id: c.team_id,
        group_reply_mode: c.group_reply_mode,
        core_url: c.core_url,
        access,
        voice_reply: to_voice_reply(c.voice_reply),
        typing_indicator: c.typing_indicator,
        publish_commands: c.publish_commands,
        rich_text: c.rich_text,
        streaming: c.streaming,
        profile: BotProfile {
            name: c.profile_name,
            short_bio: c.profile_short_bio,
            description: c.profile_description,
        },
        // Spelled out rather than filled in with `..Default::default()`: every
        // field is listed exactly once here, so a knob added to the kernel breaks
        // this mapper instead of silently defaulting and never being wired.
        send_read_receipts: true,
    }
}

fn to_channel_telegram(c: TelegramChannelConfig) -> ryu_gw_channels::TelegramChannelConfig {
    ryu_gw_channels::TelegramChannelConfig {
        token: c.token,
        common: to_common("telegram", c.common),
    }
}

fn to_channel_slack(c: SlackChannelConfig) -> ryu_gw_channels::SlackChannelConfig {
    ryu_gw_channels::SlackChannelConfig {
        app_token: c.app_token,
        bot_token: c.bot_token,
        common: to_common("slack", c.common),
    }
}

fn to_channel_discord(c: DiscordChannelConfig) -> ryu_gw_channels::DiscordChannelConfig {
    ryu_gw_channels::DiscordChannelConfig {
        token: c.token,
        channel_ids: c.channel_ids,
        thread_replies: c.thread_replies,
        common: to_common("discord", c.common),
    }
}

fn to_channel_whatsapp(c: WhatsAppChannelConfig) -> ryu_gw_channels::WhatsAppChannelConfig {
    let mut common = to_common("whatsapp", c.common);
    common.send_read_receipts = c.send_read_receipts;
    ryu_gw_channels::WhatsAppChannelConfig {
        access_token: c.access_token,
        phone_number_id: c.phone_number_id,
        verify_token: c.verify_token,
        app_secret: c.app_secret,
        webhook_bind: c.webhook_bind,
        webhook_path: c.webhook_path,
        graph_version: c.graph_version,
        common,
    }
}

fn to_channel_bluebubbles(
    c: BlueBubblesChannelConfig,
) -> ryu_gw_channels::BlueBubblesChannelConfig {
    let mut common = to_common("bluebubbles", c.common);
    // Read receipts on iMessage are a Private-API-only verb, so asking for them
    // without the helper installed would just emit failing calls every turn.
    common.send_read_receipts = c.private_api && c.send_read_receipts;
    ryu_gw_channels::BlueBubblesChannelConfig {
        server_url: c.server_url,
        password: c.password,
        webhook_bind: c.webhook_bind,
        webhook_path: c.webhook_path,
        private_api: c.private_api,
        common,
    }
}

// ─── The node's pairing store ───────────────────────────────────────────────

/// Where the pairing store lives: the [`ENV_PAIRING_PATH`] override, else
/// `<data dir>/ryu{profile suffix}/channel-pairing.json`.
///
/// The profile suffix matters here in a way it does not for, say, the audit db:
/// a dev gateway must not inherit (or write into) the release node's approvals,
/// or "approve this sender" in one profile silently admits them in the other.
/// `None` when the platform has no data dir, which the caller degrades to an
/// in-memory store.
fn pairing_store_path() -> Option<PathBuf> {
    if let Ok(raw) = std::env::var(ENV_PAIRING_PATH) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::data_local_dir().map(|d| {
        d.join(format!("ryu{}", crate::profile::suffix()))
            .join("channel-pairing.json")
    })
}

/// Load the node's shared pairing store, falling back to an ephemeral one when
/// there is nowhere to persist it. Ephemeral is safe but forgetful: senders
/// re-pair after a restart, so it is logged rather than passed over silently.
async fn load_pairing_store() -> PairingStore {
    match pairing_store_path() {
        Some(path) => PairingStore::load(path).await,
        None => {
            warn!(
                "no data directory available for the channel pairing store; \
                 approvals will not survive a gateway restart"
            );
            PairingStore::ephemeral()
        }
    }
}

// ─── The ChannelHost seam ───────────────────────────────────────────────────

/// The gateway's [`ChannelHost`]: runs a channel-originated request through the
/// pipeline with a channel-scoped [`RequestContext`].
struct GatewayChannelHost {
    state: SharedState,
}

#[async_trait]
impl ChannelHost for GatewayChannelHost {
    async fn run_pipeline(&self, channel_name: &str, body: Value) -> anyhow::Result<Value> {
        let ctx = channel_context(channel_name);
        let output = pipeline::run(self.state.clone(), ctx, body)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(output.response)
    }
}

/// Build an internal request context for channel-originated traffic.
///
/// Channel messages do not carry an HTTP API key, so we synthesise a context
/// scoped to the channel. The api_key namespaces audit/rate-limit buckets per
/// channel without requiring `auth.require_auth`.
fn channel_context(channel_name: &str) -> RequestContext {
    RequestContext {
        request_id: Uuid::new_v4().to_string(),
        api_key: format!("channel:{channel_name}"),
        is_master_key: false,
        org_id: None,
        team_id: None,
        project_id: None,
        user_name: Some(format!("{channel_name}-bot")),
        user_id: None,
        agent_id: None,
        key_config: None,
        skill_ids: None,
        // Channel messages don't carry per-agent tool grants.
        tool_actions: None,
        tools_header_present: false,
        // Channel messages don't carry per-agent slot selections; modality
        // routing falls back to the static modality_map for bot traffic.
        slot_provider: None,
        slot_model: None,
        // Channel messages don't have a session/conversation id.
        session_id: None,
        // Channel messages aren't tagged with a control-plane product surface.
        feature: None,
        // Channel messages are not companion-sourced.
        companion_source: false,
        // Channel messages do not opt into the unified tool loop.
        tool_search_requested: false,
        // Bot traffic is interactive (a user is waiting on the other end).
        priority: crate::concurrency::Priority::Interactive,
        // Channel messages don't select a named tool-policy profile.
        tool_profile: None,
        // Bots use the managed tool loops, not SDK raw passthrough.
        raw_tools: false,
        // Channel/bot traffic is not a dynamically-resolved managed tenant.
        managed_inference: false,
        remaining_budget_micro_usd: None,
        unrestricted_budget_micro_usd: None,
        pool_budgets_micro_usd: std::collections::HashMap::new(),
        resolved_policy: None,
    }
}

// ---------------------------------------------------------------------------
// Control-plane store: response types for GET /channels/gateway/enabled
// ---------------------------------------------------------------------------

/// One enabled bot config returned by the control-plane store endpoint.
///
/// The endpoint (`packages/api/src/routers/channels.ts`) serializes camelCase
/// keys (`channelType`, `agentId`, `systemPrompt`), so map them to our snake_case
/// fields — without this the store response fails to parse and the gateway
/// silently falls back to env-only channel config.
/// Every field past `system_prompt` carries `#[serde(default)]` for one reason:
/// an older control plane does not send it. Without the defaults the whole
/// response fails to parse and the gateway silently drops back to env-only
/// channels — the exact failure the `rename_all` regression caused before.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBotConfig {
    /// The channel config's control-plane id, used to report liveness back.
    id: String,
    channel_type: String,
    name: String,
    secrets: HashMap<String, String>,
    agent_id: Option<String>,
    #[serde(default)]
    team_id: Option<String>,
    model: Option<String>,
    system_prompt: Option<String>,
    /// When the bot replies in a group chat (mentions-only vs all). Absent on
    /// older control planes → serde default (mentions).
    #[serde(default)]
    group_reply_mode: ryu_gw_channels::GroupReplyMode,

    /// Who may DM the bot, and how a stranger enrols. `None` (older control
    /// plane) leaves the legacy env allowlist in charge — see [`to_access_policy`].
    #[serde(default)]
    dm_policy: Option<crate::config::DmPolicy>,
    /// Whether the bot answers in groups at all.
    #[serde(default)]
    group_policy: Option<crate::config::GroupPolicy>,
    #[serde(default)]
    dm_allowlist: Vec<String>,
    #[serde(default)]
    group_allowlist: Vec<String>,
    #[serde(default = "default_true")]
    typing_indicator: bool,
    #[serde(default = "default_true")]
    publish_commands: bool,
    #[serde(default = "default_true")]
    rich_text: bool,
    #[serde(default)]
    streaming: bool,
    #[serde(default)]
    voice_reply: VoiceReplyMode,
    /// Discord only: answer inside a thread opened on the triggering message.
    #[serde(default)]
    thread_replies: bool,
    /// WhatsApp / BlueBubbles: mark inbound messages read (blue ticks).
    #[serde(default = "default_true")]
    send_read_receipts: bool,
    #[serde(default)]
    profile_name: Option<String>,
    #[serde(default)]
    profile_short_bio: Option<String>,
    #[serde(default)]
    profile_description: Option<String>,
}

/// serde's `default` needs a function for a non-`false` boolean default. These
/// three knobs are on unless the operator turned them off, and an older control
/// plane that omits them must land on "on", not "off".
fn default_true() -> bool {
    true
}

impl StoredBotConfig {
    /// The shared knobs, in the config-FILE shape so store-sourced and
    /// env-sourced bots go through exactly one mapping path ([`to_common`]).
    fn common(&self) -> CommonChannelFileConfig {
        CommonChannelFileConfig {
            model: self
                .model
                .clone()
                .unwrap_or_else(|| DEFAULT_BOT_MODEL.to_string()),
            system_prompt: self.system_prompt.clone(),
            agent_id: self.agent_id.clone(),
            team_id: self.team_id.clone(),
            group_reply_mode: self.group_reply_mode,
            // Profile-aware, so a dev-profile gateway's store bots call the dev
            // Core rather than the release one.
            core_url: crate::config::default_core_url(),
            dm_policy: self.dm_policy,
            group_policy: self.group_policy,
            dm_allowlist: self.dm_allowlist.clone(),
            group_allowlist: self.group_allowlist.clone(),
            typing_indicator: self.typing_indicator,
            publish_commands: self.publish_commands,
            rich_text: self.rich_text,
            streaming: self.streaming,
            voice_reply: self.voice_reply,
            profile_name: self.profile_name.clone(),
            profile_short_bio: self.profile_short_bio.clone(),
            profile_description: self.profile_description.clone(),
        }
    }
}

/// Top-level response from `GET /api/channels/gateway/enabled`.
#[derive(Debug, Deserialize)]
struct StoredChannelsResponse {
    channels: Vec<StoredBotConfig>,
}

/// Fetch enabled bot configs from the control-plane store.
///
/// Returns an empty vec when the control plane is disabled, when no gateway
/// key is configured, or when the request fails — caller must treat this as
/// "no store configs available, fall back to env".
async fn fetch_store_configs(state: &SharedState) -> Vec<StoredBotConfig> {
    let cfg = &state.config.control_plane;
    let Some(key) = cfg.gateway_key.as_deref() else {
        return Vec::new();
    };

    let url = format!(
        "{}/channels/gateway/enabled",
        cfg.base_url.trim_end_matches('/')
    );

    match state
        .http
        .get(&url)
        .header("x-gateway-key", key)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<StoredChannelsResponse>().await {
                Ok(parsed) => {
                    info!(
                        count = parsed.channels.len(),
                        "loaded enabled bot configs from control-plane store"
                    );
                    parsed.channels
                }
                Err(err) => {
                    warn!(%err, "failed to parse control-plane channel configs; falling back to env");
                    Vec::new()
                }
            }
        }
        Ok(resp) => {
            warn!(
                status = %resp.status(),
                "control-plane channel store returned non-2xx; falling back to env"
            );
            Vec::new()
        }
        Err(err) => {
            warn!(%err, "control-plane channel store unreachable; falling back to env");
            Vec::new()
        }
    }
}

/// Build a [`TelegramChannelConfig`] from a store bot config.
fn telegram_cfg_from_store(bot: &StoredBotConfig) -> Option<TelegramChannelConfig> {
    let token = bot.secrets.get("bot_token")?.to_string();
    Some(TelegramChannelConfig {
        token,
        common: bot.common(),
    })
}

/// Build a [`SlackChannelConfig`] from a store bot config.
fn slack_cfg_from_store(bot: &StoredBotConfig) -> Option<SlackChannelConfig> {
    let app_token = bot.secrets.get("app_token")?.to_string();
    let bot_token = bot.secrets.get("bot_token")?.to_string();
    Some(SlackChannelConfig {
        app_token,
        bot_token,
        common: bot.common(),
    })
}

/// Build a [`DiscordChannelConfig`] from a store bot config.
fn discord_cfg_from_store(bot: &StoredBotConfig) -> Option<DiscordChannelConfig> {
    let token = bot.secrets.get("bot_token")?.to_string();
    let channel_ids = bot
        .secrets
        .get("channel_ids")
        .map(|s| {
            s.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(DiscordChannelConfig {
        token,
        channel_ids,
        thread_replies: bot.thread_replies,
        common: bot.common(),
    })
}

/// Build a [`WhatsAppChannelConfig`] from a store bot config.
fn whatsapp_cfg_from_store(bot: &StoredBotConfig) -> Option<WhatsAppChannelConfig> {
    let access_token = bot.secrets.get("access_token")?.to_string();
    let verify_token = bot.secrets.get("verify_token")?.to_string();
    let phone_number_id = bot
        .secrets
        .get("phone_number_id")
        .cloned()
        .unwrap_or_default();
    let app_secret = bot.secrets.get("app_secret").cloned().unwrap_or_default();
    Some(WhatsAppChannelConfig {
        access_token,
        phone_number_id,
        verify_token,
        app_secret,
        // The webhook receiver's bind/path are node-local plumbing, not per-bot
        // settings, so the store does not carry them; they stay at the same
        // defaults `gateway.toml` documents.
        webhook_bind: crate::config::default_whatsapp_bind(),
        webhook_path: crate::config::default_whatsapp_path(),
        graph_version: crate::config::default_whatsapp_graph_version(),
        send_read_receipts: bot.send_read_receipts,
        common: bot.common(),
    })
}

/// Build a [`BlueBubblesChannelConfig`] from a store bot config.
///
/// `server_url` + `password` are the bridge's own credentials (the Mac running
/// BlueBubbles Server); without both there is nothing to connect to.
fn bluebubbles_cfg_from_store(bot: &StoredBotConfig) -> Option<BlueBubblesChannelConfig> {
    let server_url = bot.secrets.get("server_url")?.to_string();
    let password = bot.secrets.get("password")?.to_string();
    Some(BlueBubblesChannelConfig {
        server_url,
        password,
        webhook_bind: crate::config::default_bluebubbles_bind(),
        webhook_path: crate::config::default_bluebubbles_path(),
        // The Private API helper is an extra install on the operator's Mac, so it
        // rides in `secrets` (the same opaque map Discord's `channel_ids` uses for
        // non-secret per-bot plumbing) and stays OFF unless it was declared —
        // turning it on blind would just emit failing calls. Read receipts are one
        // of the verbs it provides, hence the `&&`.
        private_api: bluebubbles_private_api(bot),
        send_read_receipts: bluebubbles_private_api(bot) && bot.send_read_receipts,
        common: bot.common(),
    })
}

/// Did the store's BlueBubbles bot declare the Private API helper as installed?
fn bluebubbles_private_api(bot: &StoredBotConfig) -> bool {
    bot.secrets
        .get("private_api")
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Build a liveness reporter for a store-sourced bot from the control-plane
/// config. `None` when the control plane is not configured.
fn store_reporter(state: &SharedState, bot_id: &str) -> Option<StatusReporter> {
    StatusReporter::new(
        state.http.clone(),
        &state.config.control_plane.base_url,
        state.config.control_plane.gateway_key.clone(),
        Some(bot_id.to_string()),
    )
}

/// Spawn every channel configured in [`GatewayConfig`](crate::config::GatewayConfig)
/// **or** stored as an enabled bot config in the control-plane store.
///
/// Called once at startup. For each channel type, the store takes precedence
/// when configs are found there; the static `config.channels` env path is
/// used as a fallback when the store is unavailable or returns no records for
/// that type. A channel that fails to start is logged and skipped.
pub async fn spawn_registered(state: SharedState) {
    // One host shared by every channel: it owns the pipeline call + context.
    let host: Arc<dyn ChannelHost> = Arc::new(GatewayChannelHost {
        state: Arc::clone(&state),
    });

    // One pairing store for the whole node, cloned into every adapter: an
    // approval must take effect on every channel at once, and the file it is
    // backed by has a single writer.
    let pairing = load_pairing_store().await;

    // Attempt to load enabled configs from the control-plane store. An
    // empty result means the store is disabled or unreachable — fall back
    // to env for all channel types.
    let store_configs = fetch_store_configs(&state).await;

    // Track which channel types were satisfied by the store so we know
    // whether to fall back to env config.
    let mut store_telegram = false;
    let mut store_slack = false;
    let mut store_discord = false;
    let mut store_whatsapp = false;
    let mut store_bluebubbles = false;

    for bot in &store_configs {
        // A store-sourced bot has a control-plane id, so it can report its live
        // connection status back for the sidebar dot. Built once per bot and
        // cloned into whichever channel adapter handles it.
        let reporter = store_reporter(&state, &bot.id);
        match bot.channel_type.as_str() {
            "telegram" => {
                if let Some(cfg) = telegram_cfg_from_store(bot) {
                    info!(name = %bot.name, "registering telegram bot from store");
                    spawn_channel(
                        &host,
                        TelegramChannel::new_with_status(
                            to_channel_telegram(cfg),
                            state.http.clone(),
                            pairing.clone(),
                            reporter,
                        ),
                    );
                    store_telegram = true;
                } else {
                    warn!(name = %bot.name, "telegram store config missing required secrets; skipping");
                }
            }
            "slack" => {
                if let Some(cfg) = slack_cfg_from_store(bot) {
                    info!(name = %bot.name, "registering slack bot from store");
                    spawn_channel(
                        &host,
                        SlackChannel::new_with_status(
                            to_channel_slack(cfg),
                            state.http.clone(),
                            pairing.clone(),
                            reporter,
                        ),
                    );
                    store_slack = true;
                } else {
                    warn!(name = %bot.name, "slack store config missing required secrets; skipping");
                }
            }
            "discord" => {
                if let Some(cfg) = discord_cfg_from_store(bot) {
                    info!(name = %bot.name, "registering discord bot from store");
                    spawn_channel(
                        &host,
                        DiscordChannel::new_with_status(
                            to_channel_discord(cfg),
                            state.http.clone(),
                            pairing.clone(),
                            reporter,
                        ),
                    );
                    store_discord = true;
                } else {
                    warn!(name = %bot.name, "discord store config missing required secrets; skipping");
                }
            }
            "whatsapp" => {
                if let Some(cfg) = whatsapp_cfg_from_store(bot) {
                    info!(name = %bot.name, "registering whatsapp bot from store");
                    spawn_channel(
                        &host,
                        WhatsAppChannel::new_with_status(
                            to_channel_whatsapp(cfg),
                            state.http.clone(),
                            pairing.clone(),
                            reporter,
                        ),
                    );
                    store_whatsapp = true;
                } else {
                    warn!(name = %bot.name, "whatsapp store config missing required secrets; skipping");
                }
            }
            "bluebubbles" => {
                if let Some(cfg) = bluebubbles_cfg_from_store(bot) {
                    info!(name = %bot.name, "registering bluebubbles bot from store");
                    spawn_channel(
                        &host,
                        BlueBubblesChannel::new_with_status(
                            to_channel_bluebubbles(cfg),
                            state.http.clone(),
                            pairing.clone(),
                            reporter,
                        ),
                    );
                    store_bluebubbles = true;
                } else {
                    warn!(name = %bot.name, "bluebubbles store config missing required secrets; skipping");
                }
            }
            other => {
                warn!(channel_type = %other, name = %bot.name, "unknown channel type in store; skipping");
            }
        }
    }

    // Env fallback: only register the env-config'd channel when the store
    // did not already supply at least one config of that type.
    //
    // These go through the same `new_with_status` constructor as the store path
    // with a `None` reporter (an env bot has no control-plane id to report
    // against), so the node's pairing store reaches every adapter either way.
    if !store_telegram {
        if let Some(cfg) = state.config.channels.telegram.clone() {
            spawn_channel(
                &host,
                TelegramChannel::new_with_status(
                    to_channel_telegram(cfg),
                    state.http.clone(),
                    pairing.clone(),
                    None,
                ),
            );
        }
    }
    if !store_slack {
        if let Some(cfg) = state.config.channels.slack.clone() {
            spawn_channel(
                &host,
                SlackChannel::new_with_status(
                    to_channel_slack(cfg),
                    state.http.clone(),
                    pairing.clone(),
                    None,
                ),
            );
        }
    }
    if !store_discord {
        if let Some(cfg) = state.config.channels.discord.clone() {
            spawn_channel(
                &host,
                DiscordChannel::new_with_status(
                    to_channel_discord(cfg),
                    state.http.clone(),
                    pairing.clone(),
                    None,
                ),
            );
        }
    }
    if !store_whatsapp {
        if let Some(cfg) = state.config.channels.whatsapp.clone() {
            spawn_channel(
                &host,
                WhatsAppChannel::new_with_status(
                    to_channel_whatsapp(cfg),
                    state.http.clone(),
                    pairing.clone(),
                    None,
                ),
            );
        }
    }
    if !store_bluebubbles {
        if let Some(cfg) = state.config.channels.bluebubbles.clone() {
            spawn_channel(
                &host,
                BlueBubblesChannel::new_with_status(
                    to_channel_bluebubbles(cfg),
                    state.http.clone(),
                    pairing.clone(),
                    None,
                ),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stored_bot_config_parses_camelcase_response() {
        // The control-plane endpoint returns camelCase keys; the struct must map
        // them (regression guard for the missing `rename_all`, which silently
        // dropped every store config and fell back to env-only channels).
        let raw = json!({
            "channels": [
                {
                    "id": "chan-123",
                    "channelType": "telegram",
                    "name": "Support Bot",
                    "secrets": { "bot_token": "tok:1" },
                    "agentId": "acp:pi",
                    "teamId": null,
                    "model": null,
                    "systemPrompt": "be nice"
                }
            ]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.channels.len(), 1);
        let bot = &parsed.channels[0];
        assert_eq!(bot.id, "chan-123");
        assert_eq!(bot.channel_type, "telegram");
        assert_eq!(bot.agent_id.as_deref(), Some("acp:pi"));
        assert_eq!(bot.system_prompt.as_deref(), Some("be nice"));
        assert!(bot.team_id.is_none());
    }

    #[test]
    fn channel_context_namespaces_api_key() {
        let ctx = channel_context("telegram");
        assert_eq!(ctx.api_key, "channel:telegram");
        assert_eq!(ctx.user_name.as_deref(), Some("telegram-bot"));
        assert!(!ctx.is_master_key);
    }

    /// A control plane that predates the behaviour knobs sends none of them. The
    /// bot must still parse AND land on the documented defaults — a missing field
    /// silently reading as `false` would turn typing indicators, the command menu
    /// and rich text off across every existing deployment.
    #[test]
    fn stored_bot_config_defaults_the_new_behaviour_fields() {
        let raw = json!({
            "channels": [
                {
                    "id": "chan-1",
                    "channelType": "telegram",
                    "name": "Old Bot",
                    "secrets": { "bot_token": "tok:1" },
                    "agentId": null,
                    "model": null,
                    "systemPrompt": null
                }
            ]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(raw).unwrap();
        let bot = &parsed.channels[0];
        assert!(bot.typing_indicator);
        assert!(bot.publish_commands);
        assert!(bot.rich_text);
        assert!(!bot.streaming);
        assert!(!bot.thread_replies);
        assert!(bot.send_read_receipts);
        assert_eq!(bot.voice_reply, VoiceReplyMode::Never);
        // No policy at all ⇒ the legacy env allowlist stays in charge.
        assert!(bot.dm_policy.is_none());
        assert!(bot.group_policy.is_none());
    }

    /// A current control plane sends every knob camelCased; each one must reach
    /// the crate config through `common()` + `to_common()`.
    #[test]
    fn stored_bot_config_maps_every_behaviour_field() {
        let raw = json!({
            "channels": [
                {
                    "id": "chan-2",
                    "channelType": "discord",
                    "name": "Loud Bot",
                    "secrets": { "bot_token": "tok:2", "channel_ids": "c1, c2" },
                    "agentId": "acp:pi",
                    "model": "claude-sonnet",
                    "systemPrompt": "be nice",
                    "dmPolicy": "open",
                    "groupPolicy": "disabled",
                    "dmAllowlist": ["u1"],
                    "groupAllowlist": ["g1"],
                    "typingIndicator": false,
                    "publishCommands": false,
                    "richText": false,
                    "streaming": true,
                    "voiceReply": "mirror",
                    "threadReplies": true,
                    "sendReadReceipts": false,
                    "profileName": "Ryu",
                    "profileShortBio": "short",
                    "profileDescription": "long"
                }
            ]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(raw).unwrap();
        let bot = &parsed.channels[0];

        let cfg = discord_cfg_from_store(bot).expect("secrets are complete");
        assert_eq!(cfg.channel_ids, vec!["c1".to_string(), "c2".to_string()]);
        assert!(cfg.thread_replies);

        let mapped = to_channel_discord(cfg);
        assert_eq!(mapped.common.model, "claude-sonnet");
        assert_eq!(mapped.common.agent_id.as_deref(), Some("acp:pi"));
        assert!(!mapped.common.typing_indicator);
        assert!(!mapped.common.publish_commands);
        assert!(!mapped.common.rich_text);
        assert!(mapped.common.streaming);
        assert_eq!(mapped.common.voice_reply, ChannelVoiceReplyMode::Mirror);
        assert_eq!(mapped.common.access.dm, crate::config::DmPolicy::Open);
        assert_eq!(
            mapped.common.access.group,
            crate::config::GroupPolicy::Disabled
        );
        assert_eq!(mapped.common.access.dm_allowlist, vec!["u1".to_string()]);
        assert_eq!(mapped.common.access.group_allowlist, vec!["g1".to_string()]);
        assert_eq!(mapped.common.profile.name.as_deref(), Some("Ryu"));
        assert_eq!(mapped.common.profile.short_bio.as_deref(), Some("short"));
        assert_eq!(mapped.common.profile.description.as_deref(), Some("long"));
    }

    /// An unconfigured channel inherits the legacy env gate untouched: that is
    /// what keeps a deployment relying on `RYU_CHANNEL_ALLOWED_USERS` working.
    #[test]
    fn access_policy_falls_back_to_the_legacy_env_gate() {
        let file = CommonChannelFileConfig::default();
        let from_env = policy_from_env("telegram");
        let resolved = to_access_policy("telegram", &file);
        assert_eq!(resolved.dm, from_env.dm);
        assert_eq!(resolved.group, from_env.group);
        assert_eq!(resolved.dm_allowlist, from_env.dm_allowlist);

        // An explicit policy overrides it, and an explicit list replaces it.
        let configured = CommonChannelFileConfig {
            dm_policy: Some(crate::config::DmPolicy::Disabled),
            dm_allowlist: vec!["only-me".to_string()],
            ..CommonChannelFileConfig::default()
        };
        let resolved = to_access_policy("telegram", &configured);
        assert_eq!(resolved.dm, crate::config::DmPolicy::Disabled);
        assert_eq!(resolved.dm_allowlist, vec!["only-me".to_string()]);
    }

    /// BlueBubbles' Private-API-only verbs stay off unless the bot declared the
    /// helper, whatever the generic read-receipt flag says.
    #[test]
    fn bluebubbles_read_receipts_require_the_private_api() {
        let mut secrets = HashMap::new();
        secrets.insert("server_url".to_string(), "http://mac:1234".to_string());
        secrets.insert("password".to_string(), "pw".to_string());
        let raw = json!({
            "channels": [{
                "id": "bb-1",
                "channelType": "bluebubbles",
                "name": "iMessage",
                "secrets": secrets,
                "agentId": null,
                "model": null,
                "systemPrompt": null,
                "sendReadReceipts": true
            }]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(raw).unwrap();
        let cfg = bluebubbles_cfg_from_store(&parsed.channels[0]).expect("secrets are complete");
        assert!(!cfg.private_api, "helper not declared ⇒ stays off");
        assert!(!cfg.send_read_receipts, "and so do the verbs that need it");

        // Declaring the helper turns both on.
        let with_helper = json!({
            "channels": [{
                "id": "bb-2",
                "channelType": "bluebubbles",
                "name": "iMessage",
                "secrets": {
                    "server_url": "http://mac:1234",
                    "password": "pw",
                    "private_api": "true"
                },
                "agentId": null,
                "model": null,
                "systemPrompt": null,
                "sendReadReceipts": true
            }]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(with_helper).unwrap();
        let cfg = bluebubbles_cfg_from_store(&parsed.channels[0]).unwrap();
        assert!(cfg.private_api);
        assert!(cfg.send_read_receipts);
    }

    /// The store never carries the bridge's URL/password in a shape we can
    /// half-use: both or nothing.
    #[test]
    fn bluebubbles_store_config_needs_both_secrets() {
        let raw = json!({
            "channels": [{
                "id": "bb-3",
                "channelType": "bluebubbles",
                "name": "iMessage",
                "secrets": { "server_url": "http://mac:1234" },
                "agentId": null,
                "model": null,
                "systemPrompt": null
            }]
        });
        let parsed: StoredChannelsResponse = serde_json::from_value(raw).unwrap();
        assert!(bluebubbles_cfg_from_store(&parsed.channels[0]).is_none());
    }

    /// The pairing store must land under the profile's own data dir, so a dev
    /// gateway never reads or writes the release node's approvals.
    #[test]
    fn pairing_store_path_is_profile_scoped() {
        std::env::remove_var(ENV_PAIRING_PATH);
        if let Some(path) = pairing_store_path() {
            assert!(path.ends_with("channel-pairing.json"));
            let parent = path
                .parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy();
            assert_eq!(parent, format!("ryu{}", crate::profile::suffix()));
        }

        // The override wins outright, for state on a mounted volume.
        std::env::set_var(ENV_PAIRING_PATH, "/tmp/ryu-pairing-test.json");
        assert_eq!(
            pairing_store_path(),
            Some(PathBuf::from("/tmp/ryu-pairing-test.json"))
        );
        std::env::remove_var(ENV_PAIRING_PATH);
    }
}
