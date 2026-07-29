//! Channel layer: external messaging surfaces (Telegram, Slack, WhatsApp,
//! Discord, BlueBubbles/iMessage) that register once at the gateway. Inbound
//! messages become Core session turns; outbound responses route back to the
//! originating chat.
//!
//! # Shape
//!
//! An adapter owns exactly two things: its **transport** (long-poll loop, webhook
//! receiver, socket) and its **platform verbs** (how to send text, show a typing
//! indicator, attach a file). Everything between those two — the access gate, the
//! media round trip, the Core call, the reply delivery — is shared and lives in
//! [`handle_turn`]. Adding a channel therefore means implementing [`Channel`] and
//! nothing else; it does not mean re-deriving how pairing works or how a voice
//! note is transcribed.
//!
//! That split is the reason for [`ChannelRuntime`]: the per-bot state every
//! adapter needs (Core route, access policy, pairing store, voice mode, published
//! command menu) lives in one struct the adapter embeds and exposes via
//! [`Channel::runtime`], instead of being copy-pasted field-by-field into five
//! adapters as it previously was.
//!
//! # Capabilities
//!
//! Platforms differ enormously in what they can express — Telegram has forum
//! topics, rich-text documents and streaming drafts; WhatsApp has none of those.
//! Rather than lowest-common-denominator everything, each adapter declares a
//! [`ChannelCaps`] and the shared path uses the best available verb, falling back
//! to plain text. Every capability method on [`Channel`] has a default
//! implementation, so an adapter only overrides what its platform actually does.
//!
//! # Access
//!
//! Inbound is closed to strangers by default. The gate is [`pairing`]: an unknown
//! DM sender is answered with a one-time code that an operator must approve, and
//! groups are allowlisted. The legacy flat env allowlist
//! (`RYU_CHANNEL_ALLOWED_USERS[_<PLATFORM>]`, `RYU_CHANNEL_ALLOW_ALL`) still
//! configures that policy — see [`policy_from_env`].

pub mod bluebubbles;
pub mod commands;
pub mod discord;
pub mod media;
pub mod pairing;
pub mod slack;
pub mod status;
pub mod telegram;
pub mod whatsapp;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::commands::ChannelCommand;
use crate::media::{Attachment, VoiceDelivery, VoiceReplyMode};
use crate::pairing::{AccessPolicy, Decision, DmPolicy, GroupPolicy, PairingStore};
use crate::status::StatusReporter;

// ─── Channel-layer configuration (transport-adapter shapes) ─────────────────
//
// These plain structs hold exactly the fields each adapter needs at spawn. The
// config-FILE shapes (serde-derived, profile-aware `core_url` defaults) live in
// `apps/gateway/src/config.rs` — the gateway config shell (kernel §5) — which
// maps them into these at the spawn boundary. `GroupReplyMode` is the shared
// channel-domain type; gateway `config.rs` re-exports it so `config::GroupReplyMode`
// stays a valid path.

/// When a bot replies inside a GROUP/multi-user chat. Direct messages are always
/// answered regardless; this only gates the noisy group case. Mirrors the
/// control-plane `GROUP_REPLY_MODES` (`packages/db/src/models/channel.model.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupReplyMode {
    /// Reply only when the bot is @mentioned, replied to, or addressed by a
    /// command. The safe default — a group bot otherwise answers every message.
    #[default]
    Mentions,
    /// Reply to every message in the group.
    All,
}

/// Behaviour shared by every channel config, independent of transport.
///
/// Grouped into one struct so adding a knob (a new access policy, a voice mode)
/// is a single edit rather than the same field appended to five config structs
/// and five `to_channel_*` mappers.
#[derive(Debug, Clone)]
pub struct CommonChannelConfig {
    pub model: String,
    pub system_prompt: Option<String>,
    pub agent_id: Option<String>,
    pub team_id: Option<String>,
    pub group_reply_mode: GroupReplyMode,
    pub core_url: String,
    /// DM/group access rules. Defaults to pairing for DMs and allowlist for
    /// groups; [`policy_from_env`] derives it from the legacy env vars.
    pub access: AccessPolicy,
    /// When to answer with synthesized speech.
    pub voice_reply: VoiceReplyMode,
    /// Show a platform typing indicator while the agent is working.
    pub typing_indicator: bool,
    /// Mark inbound messages read (blue ticks) when the bot picks them up.
    ///
    /// Lives here, not on the two configs whose platforms implement it, because
    /// [`handle_turn`] is what calls [`Channel::mark_read`] — a per-channel field
    /// would be invisible at the only place that reads it, and the setting would
    /// silently ride on `typing_indicator` instead.
    pub send_read_receipts: bool,
    /// Publish the Ryu command menu to the platform where one exists.
    pub publish_commands: bool,
    /// Render replies as platform rich text where supported, instead of plain.
    pub rich_text: bool,
    /// Stream partial output where the platform supports drafts.
    pub streaming: bool,
    /// Bot profile the adapter pushes at startup (name / short bio / description).
    pub profile: BotProfile,
}

impl Default for CommonChannelConfig {
    fn default() -> Self {
        Self {
            model: String::new(),
            system_prompt: None,
            agent_id: None,
            team_id: None,
            group_reply_mode: GroupReplyMode::default(),
            core_url: "http://127.0.0.1:7980".to_string(),
            access: AccessPolicy::default(),
            voice_reply: VoiceReplyMode::default(),
            typing_indicator: true,
            send_read_receipts: true,
            publish_commands: true,
            rich_text: true,
            streaming: false,
            profile: BotProfile::default(),
        }
    }
}

/// Operator-customisable bot profile. Empty fields are left untouched on the
/// platform rather than cleared — an operator who sets only a bio should not
/// silently wipe the bot's name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BotProfile {
    /// Display name (Telegram `setMyName`, Discord `PATCH /users/@me`).
    pub name: Option<String>,
    /// Short bio shown on the profile page (Telegram `setMyShortDescription`,
    /// max 120 chars).
    pub short_bio: Option<String>,
    /// Longer description shown in an empty chat (Telegram `setMyDescription`,
    /// max 512 chars).
    pub description: Option<String>,
}

impl BotProfile {
    /// Nothing to push.
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.short_bio.is_none() && self.description.is_none()
    }

    /// Clip each field to the platform's documented ceiling so a too-long bio is
    /// truncated rather than rejected wholesale at publish time.
    pub fn clipped(&self) -> Self {
        fn clip(v: &Option<String>, max: usize) -> Option<String> {
            v.as_deref().map(|s| s.chars().take(max).collect())
        }
        Self {
            name: clip(&self.name, 64),
            short_bio: clip(&self.short_bio, 120),
            description: clip(&self.description, 512),
        }
    }
}

/// Telegram bot adapter configuration.
#[derive(Debug, Clone)]
pub struct TelegramChannelConfig {
    pub token: String,
    pub common: CommonChannelConfig,
}

/// Slack bot adapter configuration (Socket Mode).
#[derive(Debug, Clone)]
pub struct SlackChannelConfig {
    pub app_token: String,
    pub bot_token: String,
    pub common: CommonChannelConfig,
}

/// Discord bot adapter configuration.
#[derive(Debug, Clone)]
pub struct DiscordChannelConfig {
    pub token: String,
    pub channel_ids: Vec<String>,
    /// Open a thread per triggering message and answer inside it, keeping a busy
    /// channel readable. Mirrors OpenClaw's `threadBindings`.
    pub thread_replies: bool,
    pub common: CommonChannelConfig,
}

/// WhatsApp Business (Meta Cloud API) adapter configuration.
#[derive(Debug, Clone)]
pub struct WhatsAppChannelConfig {
    pub access_token: String,
    pub phone_number_id: String,
    pub verify_token: String,
    pub app_secret: String,
    pub webhook_bind: String,
    pub webhook_path: String,
    pub graph_version: String,
    pub common: CommonChannelConfig,
}

/// BlueBubbles (iMessage bridge running on a Mac) adapter configuration.
#[derive(Debug, Clone)]
pub struct BlueBubblesChannelConfig {
    /// Base URL of the BlueBubbles Server, e.g. `http://192.168.1.10:1234`.
    pub server_url: String,
    /// The server password, sent as the `password` query parameter.
    pub password: String,
    /// Local bind for the webhook receiver BlueBubbles POSTs into.
    pub webhook_bind: String,
    /// Path BlueBubbles is configured to POST to.
    pub webhook_path: String,
    /// Use the Private API helper for typing indicators, read receipts and
    /// tapbacks. Requires the operator to have installed it on the Mac.
    pub private_api: bool,
    pub common: CommonChannelConfig,
}

/// What a channel adapter can do beyond sending plain text.
///
/// Declared per adapter and consulted by [`handle_turn`], so a platform gets its
/// best available verb without the shared path branching on channel names.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ChannelCaps {
    /// A typing / "is composing" indicator can be shown.
    pub typing: bool,
    /// Replies can carry platform rich text (headings, lists, tables).
    pub rich_text: bool,
    /// Partial output can be streamed before the reply is final.
    pub streaming: bool,
    /// Conversations can be threaded (forum topics, Discord threads, Slack
    /// thread_ts).
    pub threads: bool,
    /// The platform has a native command menu that can be registered.
    pub command_menu: bool,
    /// Audio can be sent back as a voice note or audio attachment.
    pub voice: bool,
    /// Arbitrary files can be attached to a reply.
    pub attachments: bool,
    /// Emoji reactions can be placed on a message.
    pub reactions: bool,
}

/// An inbound message received from a channel, normalised across providers.
#[derive(Debug, Clone, Default)]
pub struct InboundMessage {
    /// Opaque identifier of the conversation to reply to, and the Core
    /// `conversation_id`. Threaded platforms pack the thread into it — see
    /// [`pack_thread`] — so each thread keeps its own history.
    pub chat_id: String,
    /// The user's message text (a transcript, for a voice note).
    pub text: String,
    /// Display name of the speaker, for multi-party chats. Connector-supplied and
    /// UNVERIFIED: recorded on the turn so the agent can attribute who spoke,
    /// never used for authorization.
    pub author_name: Option<String>,
    /// Stable per-user id on the platform, used by the pairing gate. Falls back to
    /// the chat id on platforms where a DM chat *is* the user.
    pub sender_id: Option<String>,
    /// Platform message id, needed to react, mark read, or open a thread.
    pub message_id: Option<String>,
    /// True when the message came from a group / multi-user conversation.
    pub is_group: bool,
    /// Media the user attached.
    pub attachments: Vec<Attachment>,
}

impl InboundMessage {
    /// A plain text message with no media — the common case, and what the older
    /// two-field struct literal used to express.
    pub fn text(chat_id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            chat_id: chat_id.into(),
            text: text.into(),
            ..Default::default()
        }
    }

    /// The pairing identity for this sender: the platform user id when known,
    /// otherwise the chat id.
    pub fn identity(&self) -> &str {
        self.sender_id.as_deref().unwrap_or(&self.chat_id)
    }

    /// Did the user speak rather than type?
    pub fn is_voice(&self) -> bool {
        self.attachments
            .iter()
            .any(|a| a.resolved_kind().is_speech())
    }
}

/// Per-bot state shared by the transport-agnostic path.
///
/// One of these is embedded in each adapter and exposed via [`Channel::runtime`].
/// It owns the Core route, the access policy, and the cached command menu, so
/// those live in exactly one place rather than being duplicated per adapter.
pub struct ChannelRuntime {
    pub http: reqwest::Client,
    pub cfg: CommonChannelConfig,
    /// Pairing state for this node, shared across every channel on it.
    pub pairing: PairingStore,
    /// Reports this bot's live connection status to the control plane. `None`
    /// for env-configured bots (no store id), which then show as `unknown`.
    pub status: Option<StatusReporter>,
    /// The command menu last fetched from Core.
    commands: RwLock<Vec<ChannelCommand>>,
}

impl ChannelRuntime {
    pub fn new(
        http: reqwest::Client,
        cfg: CommonChannelConfig,
        pairing: PairingStore,
        status: Option<StatusReporter>,
    ) -> Self {
        Self {
            http,
            cfg,
            pairing,
            status,
            commands: RwLock::new(Vec::new()),
        }
    }

    /// True when this bot routes through Core's session seam (a single agent or a
    /// team) rather than the legacy gateway-pipeline path.
    pub fn routes_via_core(&self) -> bool {
        self.cfg.agent_id.is_some() || self.cfg.team_id.is_some()
    }

    /// Route one turn through Core's session seam and return the reply.
    ///
    /// `POST <core_url>/api/channels/run` with `conversation_id` keyed to the
    /// chat (or packed chat+thread), so multi-turn exchanges share history. Model
    /// calls still flow Core → Gateway, keeping the moat (firewall, DLP, budgets,
    /// audit) on path for every bot-initiated call.
    ///
    /// # Errors
    /// Returns `Err` on HTTP transport failure or a non-2xx from Core.
    pub async fn run_via_core(
        &self,
        conversation_id: &str,
        text: &str,
        author_name: Option<&str>,
    ) -> anyhow::Result<String> {
        let url = format!(
            "{}/api/channels/run",
            self.cfg.core_url.trim_end_matches('/')
        );
        let resp = self
            .http
            .post(&url)
            .json(&json!({
                "conversation_id": conversation_id,
                "agent_id": self.cfg.agent_id,
                "team_id": self.cfg.team_id,
                "text": text,
                "author_name": author_name,
            }))
            .send()
            .await?
            .error_for_status()?;
        let body: Value = resp.json().await?;
        Ok(body["reply"].as_str().unwrap_or("").to_owned())
    }

    /// Refresh the cached command menu from Core. Returns the new list.
    pub async fn refresh_commands(&self) -> Vec<ChannelCommand> {
        let fetched = commands::fetch(&self.http, &self.cfg.core_url).await;
        *self.commands.write().await = fetched.clone();
        fetched
    }

    /// The cached command menu.
    pub async fn commands(&self) -> Vec<ChannelCommand> {
        self.commands.read().await.clone()
    }

    /// Transcribe every speech attachment and fold the transcripts into the turn
    /// text. `downloaded` pairs an index into `message.attachments` with its
    /// bytes; the adapter does the download because only it knows the platform's
    /// auth and resolve step.
    ///
    /// Is this sender ALREADY admitted — without minting anything?
    ///
    /// The read-only twin of the gate in [`handle_turn`]. It exists because the
    /// authoritative gate necessarily runs *inside* `handle_turn`, while the
    /// expensive part of an inbound turn — downloading a voice note and paying for
    /// a transcription — happens in the adapter *before* it. Without this check an
    /// unpaired stranger on an unauthenticated ingress could spend the operator's
    /// STT budget simply by sending audio, which is exactly what the gate is for.
    ///
    /// Deliberately non-mutating, unlike [`AccessPolicy::decide_dm`]: that one
    /// *mints* a pairing code and writes the store, so calling it speculatively on
    /// every inbound would let forged senders drive disk writes. An unknown sender
    /// answers `false` here and is challenged once, later, by the real gate.
    ///
    /// Policy is not duplicated — this reads the same [`AccessPolicy`] and the same
    /// [`PairingStore`] the gate does; it just declines to create state.
    pub async fn already_admitted(&self, platform: &str, message: &InboundMessage) -> bool {
        if message.is_group {
            return matches!(
                self.cfg.access.decide_group(&message.chat_id),
                Decision::Allow
            );
        }
        let identity = message.identity();
        if self.cfg.access.dm_allowlist.iter().any(|id| id == identity) {
            return true;
        }
        match self.cfg.access.dm {
            DmPolicy::Open => true,
            DmPolicy::Allowlist | DmPolicy::Disabled => false,
            DmPolicy::Pairing => matches!(
                self.pairing.get(platform, identity).await,
                Some(pairing::PairState::Paired { .. })
            ),
        }
    }

    /// A transcription failure degrades to a placeholder rather than dropping the
    /// turn — the user gets an answer that acknowledges the voice note instead of
    /// silence. Annotation of NON-speech media is not done here; [`handle_turn`]
    /// applies it once, for every adapter.
    pub async fn ingest_media(
        &self,
        message: &mut InboundMessage,
        downloaded: Vec<(usize, Vec<u8>)>,
    ) {
        for (index, bytes) in downloaded {
            let Some(attachment) = message.attachments.get(index) else {
                continue;
            };
            if !attachment.resolved_kind().is_speech() {
                continue;
            }
            let filename = attachment.safe_filename();
            match media::transcribe(&self.http, &self.cfg.core_url, bytes, &filename).await {
                Ok(transcript) if !transcript.trim().is_empty() => {
                    if message.text.trim().is_empty() {
                        message.text = transcript;
                    } else {
                        message.text = format!("{}\n\n{transcript}", message.text);
                    }
                }
                Ok(_) => {
                    warn!("channel voice note transcribed to nothing");
                    if message.text.trim().is_empty() {
                        message.text = "[voice message — nothing could be transcribed]".to_string();
                    }
                }
                Err(err) => {
                    warn!(%err, "channel voice transcription failed");
                    if message.text.trim().is_empty() {
                        message.text = "[voice message — transcription unavailable]".to_string();
                    }
                }
            }
        }
    }
}

/// A registered channel: a messaging surface the gateway can receive from and
/// reply to. Implementors own their transport and their platform verbs.
///
/// Every method past [`Channel::send_message`] has a default, so an adapter for a
/// text-only platform implements exactly what the old trait required.
#[async_trait]
pub trait Channel: Send + Sync {
    /// Stable identifier for this channel, e.g. `"telegram"`.
    fn name(&self) -> &'static str;

    /// Shared per-bot state (Core route, access policy, command cache).
    fn runtime(&self) -> &ChannelRuntime;

    /// Deliver an outbound reply back to the originating chat.
    async fn send_message(&self, chat_id: &str, text: &str) -> anyhow::Result<()>;

    /// Run the channel's inbound loop until the process exits. Each inbound
    /// message should be passed to [`handle_turn`].
    async fn run(self: Arc<Self>, host: Arc<dyn ChannelHost>) -> anyhow::Result<()>;

    /// What this platform can express beyond plain text.
    fn caps(&self) -> ChannelCaps {
        ChannelCaps::default()
    }

    /// Model the inbound messages should be routed to.
    fn model(&self) -> &str {
        &self.runtime().cfg.model
    }

    /// Optional system prompt prepended to every conversation.
    fn system_prompt(&self) -> Option<&str> {
        self.runtime().cfg.system_prompt.as_deref()
    }

    /// Show a typing indicator. Best-effort: platforms expire it after a few
    /// seconds, so [`keep_typing`] re-asserts it on [`Channel::typing_interval`].
    ///
    /// `chat_id` is the PACKED conversation key, exactly like every other send —
    /// after [`Channel::open_thread`] it may be `"<chat>:<thread>"`. Unpack it
    /// with [`unpack_thread`] before calling the platform, or a threaded turn
    /// spends the whole agent call posting to a chat id that does not exist.
    async fn send_typing(&self, _chat_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    /// How often the typing indicator must be re-asserted to stay visible.
    /// Telegram expires after 5s and Discord after 10s, so the default is set
    /// under the tighter of the two.
    fn typing_interval(&self) -> Duration {
        Duration::from_secs(4)
    }

    /// Send a reply rendered as platform rich text. Defaults to plain text, which
    /// is exactly right for a platform without a rich-text surface.
    async fn send_rich(&self, chat_id: &str, markdown: &str) -> anyhow::Result<()> {
        self.send_message(chat_id, markdown).await
    }

    /// Push a partial, ephemeral draft while the reply is still being generated.
    /// `draft_id` is stable across one turn so the platform animates the diff.
    async fn send_draft(
        &self,
        _chat_id: &str,
        _draft_id: i64,
        _partial: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    /// Send synthesized speech. `wav` is Core's TTS output; `delivery` states what
    /// the platform will accept (see [`media::wav_delivery`]).
    async fn send_voice(
        &self,
        _chat_id: &str,
        _wav: Vec<u8>,
        _delivery: VoiceDelivery,
    ) -> anyhow::Result<()> {
        anyhow::bail!("{} cannot send audio", self.name())
    }

    /// Place an emoji reaction on a message. Used to acknowledge receipt without
    /// adding a message to the conversation.
    async fn react(&self, _chat_id: &str, _message_id: &str, _emoji: &str) -> anyhow::Result<()> {
        Ok(())
    }

    /// Mark the conversation read on the platform (blue ticks).
    async fn mark_read(&self, _chat_id: &str, _message_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    /// Register the command menu with the platform.
    async fn publish_commands(&self, _cmds: &[ChannelCommand]) -> anyhow::Result<()> {
        Ok(())
    }

    /// Push the operator-configured bot profile (name / bio / description).
    async fn publish_profile(&self, _profile: &BotProfile) -> anyhow::Result<()> {
        Ok(())
    }

    /// Open a thread for this turn and return the conversation key to answer in.
    /// Defaults to answering in the originating chat.
    async fn open_thread(&self, chat_id: &str, _message: &InboundMessage) -> String {
        chat_id.to_string()
    }
}

/// The gateway seam a channel needs: run one channel-originated request body
/// through the gateway pipeline and return the raw completion response.
///
/// This is the whole coupling between the channel-layer engine and the gateway.
/// The host (implemented in `apps/gateway/src/channels_host.rs`) owns
/// `RequestContext` construction — api-key namespacing, priority — and the
/// `pipeline::run` call. Keeping it behind this trait is what lets the
/// transport adapters live in their own crate without dragging in `SharedState`,
/// the pipeline, or `RequestContext` ("engine moves, wiring stays").
#[async_trait]
pub trait ChannelHost: Send + Sync {
    /// Run `body` (an OpenAI-style chat request built by [`build_request_body`])
    /// through the gateway pipeline, tagging audit/rate-limit buckets by
    /// `channel_name`. Returns the raw completion response.
    async fn run_pipeline(&self, channel_name: &str, body: Value) -> anyhow::Result<Value>;
}

/// Build the OpenAI-style request body for an inbound channel message.
///
/// Pure and synchronous so it can be unit-tested without a running gateway.
pub fn build_request_body(model: &str, system_prompt: Option<&str>, text: &str) -> Value {
    let mut messages = Vec::with_capacity(2);
    if let Some(system) = system_prompt {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": text }));

    json!({
        "model": model,
        "messages": messages,
        "stream": false,
    })
}

/// Extract the assistant reply text from a gateway pipeline response.
pub fn extract_reply(response: &Value) -> Option<String> {
    response["choices"]
        .as_array()
        .and_then(|choices| choices.first())
        .and_then(|choice| choice["message"]["content"].as_str())
        .map(|s| s.to_string())
}

// ─── Thread packing ─────────────────────────────────────────────────────────
//
// Threaded platforms need two ids to answer (the room and the thread within it)
// but Core takes ONE opaque `conversation_id`. Slack solved this by packing
// `"<channel>:<thread_ts>"`; the same trick generalises, so Telegram topics and
// Discord threads reuse it rather than inventing a third convention. Packing is
// also what gives each thread its own conversation history, which is the point.

/// Pack a room id and an optional thread id into one conversation key.
pub fn pack_thread(chat_id: &str, thread_id: Option<&str>) -> String {
    match thread_id.filter(|t| !t.is_empty()) {
        Some(thread) => format!("{chat_id}:{thread}"),
        None => chat_id.to_string(),
    }
}

/// Split a packed conversation key back into `(chat_id, thread_id)`.
///
/// Splits on the LAST separator so a chat id that itself contains a colon
/// survives the round trip.
pub fn unpack_thread(packed: &str) -> (&str, Option<&str>) {
    match packed.rsplit_once(':') {
        Some((chat, thread)) if !thread.is_empty() && !chat.is_empty() => (chat, Some(thread)),
        _ => (packed, None),
    }
}

// ─── Access policy from the legacy env vars ─────────────────────────────────

/// Env var opting a deployment into accepting ALL inbound chats when no
/// allowlist is configured. A bot token grants LLM completions billed to the
/// operator, so this is the explicit escape hatch (`1`/`true`/`yes`/`on`,
/// case-insensitive).
const ENV_CHANNEL_ALLOW_ALL: &str = "RYU_CHANNEL_ALLOW_ALL";

/// Per-platform / global allowed-chat list for inbound channel traffic.
///
/// Env: `RYU_CHANNEL_ALLOWED_USERS` (global, all platforms) and
/// `RYU_CHANNEL_ALLOWED_USERS_<PLATFORM>` (e.g. `_TELEGRAM`). Comma-separated
/// chat ids; the per-platform key overrides the global one.
fn channel_allowlist(platform: &str) -> Option<Vec<String>> {
    let per_platform_key = format!(
        "RYU_CHANNEL_ALLOWED_USERS_{}",
        platform.to_ascii_uppercase()
    );
    let raw = std::env::var(&per_platform_key)
        .ok()
        .or_else(|| std::env::var("RYU_CHANNEL_ALLOWED_USERS").ok())?;
    let list: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if list.is_empty() {
        None
    } else {
        Some(list)
    }
}

/// Pure: does this env value opt into open mode? Only an explicit enable token
/// counts — absent or anything else stays closed. Unit-testable without env.
fn channel_allow_all_from(val: Option<&str>) -> bool {
    matches!(
        val.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

/// Runtime wrapper: read [`ENV_CHANNEL_ALLOW_ALL`] and classify.
fn channel_allow_all() -> bool {
    channel_allow_all_from(std::env::var(ENV_CHANNEL_ALLOW_ALL).ok().as_deref())
}

/// Pure core of [`policy_from_env`], so the mapping is testable without env.
///
/// The three legacy states map onto the richer policy as follows:
///
/// | env                     | DMs        | groups     |
/// |-------------------------|------------|------------|
/// | allowlist set           | allowlist  | allowlist  |
/// | none + `ALLOW_ALL=1`    | open       | open       |
/// | none                    | **pairing**| allowlist (empty ⇒ closed) |
///
/// The last row is the one behaviour change: a bot with no configuration used to
/// refuse every message with only a log line to explain it. It now answers a
/// stranger with a pairing code they can get approved. Groups stay closed —
/// nobody is admitted without a human acting, which is the property that
/// mattered.
pub fn policy_from(allowlist: Option<Vec<String>>, allow_all: bool) -> AccessPolicy {
    match (allowlist, allow_all) {
        (Some(list), _) => AccessPolicy {
            dm: DmPolicy::Allowlist,
            group: GroupPolicy::Allowlist,
            dm_allowlist: list.clone(),
            group_allowlist: list,
        },
        (None, true) => AccessPolicy {
            dm: DmPolicy::Open,
            group: GroupPolicy::Open,
            ..Default::default()
        },
        (None, false) => AccessPolicy {
            dm: DmPolicy::Pairing,
            group: GroupPolicy::Allowlist,
            ..Default::default()
        },
    }
}

/// Derive a channel's [`AccessPolicy`] from the legacy env vars.
pub fn policy_from_env(platform: &str) -> AccessPolicy {
    policy_from(channel_allowlist(platform), channel_allow_all())
}

// ─── Typing indicator keepalive ─────────────────────────────────────────────

/// A live typing indicator. Dropping it stops the indicator.
///
/// Platforms expire a typing status after a few seconds so a bot that shows it
/// once appears to stop working immediately. This re-asserts it on a ticker and
/// aborts on drop, which makes the correct usage — hold it across the agent call
/// — the same as the easy usage.
pub struct TypingGuard {
    handle: tokio::task::JoinHandle<()>,
}

impl Drop for TypingGuard {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Show a typing indicator in `chat_id` until the returned guard is dropped.
pub fn keep_typing<C: Channel + 'static>(channel: Arc<C>, chat_id: String) -> TypingGuard {
    let interval = channel.typing_interval();
    let handle = tokio::spawn(async move {
        loop {
            if let Err(err) = channel.send_typing(&chat_id).await {
                // A platform that refuses the indicator (missing scope, closed
                // chat) must not spin: log once and stop trying for this turn.
                warn!(
                    channel = channel.name(),
                    %err,
                    "typing indicator failed; not retrying for this turn"
                );
                return;
            }
            tokio::time::sleep(interval).await;
        }
    });
    TypingGuard { handle }
}

// ─── The shared inbound path ────────────────────────────────────────────────

/// Handle one inbound message end to end: gate it, ingest its media, run it, and
/// deliver the reply with the best verbs the platform has.
///
/// This is what makes channel registration reusable — every adapter funnels
/// through here, so only the transport and the platform verbs differ per channel.
pub async fn handle_turn<C: Channel + 'static>(
    channel: Arc<C>,
    host: Arc<dyn ChannelHost>,
    mut message: InboundMessage,
) {
    let runtime = channel.runtime();
    let platform = channel.name();

    // 1. Access gate. Groups are static; DMs may issue a pairing challenge, which
    //    is the one "denied" case that still sends a reply.
    let decision = if message.is_group {
        runtime.cfg.access.decide_group(&message.chat_id)
    } else {
        runtime
            .cfg
            .access
            .decide_dm(&runtime.pairing, platform, message.identity())
            .await
    };
    match decision {
        Decision::Allow => {}
        Decision::Deny => {
            warn!(
                channel = platform,
                chat_id = %message.chat_id,
                is_group = message.is_group,
                "channel inbound refused by access policy"
            );
            return;
        }
        Decision::Challenge(code) | Decision::Pending(code) => {
            info!(
                channel = platform,
                chat_id = %message.chat_id,
                "channel inbound held for pairing approval"
            );
            if let Err(err) = channel
                .send_message(&message.chat_id, &pairing::pairing_prompt(&code))
                .await
            {
                warn!(channel = platform, %err, "failed to deliver pairing prompt");
            }
            return;
        }
    }

    // 2. Acknowledge receipt on platforms that support it, before the slow part.
    //    Gated on its OWN setting: an operator who turned typing off has not
    //    asked to stop marking messages read, and vice versa.
    if runtime.cfg.send_read_receipts {
        if let Some(message_id) = message.message_id.clone() {
            let _ = channel.mark_read(&message.chat_id, &message_id).await;
        }
    }

    // 3. Fold attachments into the turn text (voice → transcript, others → note).
    if !message.attachments.is_empty() {
        message.text = media::annotate(&message.text, &message.attachments);
    }
    if message.text.trim().is_empty() {
        warn!(
            channel = platform,
            "channel inbound had no usable text after media ingest; dropping"
        );
        return;
    }

    // 4. Thread the reply where the platform supports it, and key the Core
    //    conversation to the thread so each one keeps its own history.
    let conversation_id = if channel.caps().threads {
        channel.open_thread(&message.chat_id, &message).await
    } else {
        message.chat_id.clone()
    };

    // 5. Typing indicator for the duration of the agent call. The guard aborts on
    //    drop, so every early return below stops it too.
    let _typing = if runtime.cfg.typing_indicator && channel.caps().typing {
        Some(keep_typing(Arc::clone(&channel), conversation_id.clone()))
    } else {
        None
    };

    info!(
        channel = platform,
        chat_id = %conversation_id,
        voice = message.is_voice(),
        "channel inbound message received"
    );

    // 6. Run the turn: Core's session seam when an agent/team is bound (history
    //    persists, moat stays on path), else the legacy gateway pipeline.
    let reply = if runtime.routes_via_core() {
        match runtime
            .run_via_core(
                &conversation_id,
                &message.text,
                message.author_name.as_deref(),
            )
            .await
        {
            Ok(reply) if !reply.is_empty() => reply,
            Ok(_) => "(no response)".to_string(),
            Err(err) => {
                warn!(channel = platform, %err, "channel Core session run failed");
                format!("Sorry, something went wrong: {err}")
            }
        }
    } else {
        let body = build_request_body(channel.model(), channel.system_prompt(), &message.text);
        match host.run_pipeline(platform, body).await {
            Ok(response) => extract_reply(&response).unwrap_or_else(|| "(no response)".to_string()),
            Err(err) => {
                warn!(channel = platform, %err, "channel pipeline run failed");
                format!("Sorry, something went wrong: {err}")
            }
        }
    };

    // 7. Deliver. Rich text when the platform and the operator both want it.
    let sent = if runtime.cfg.rich_text && channel.caps().rich_text {
        channel.send_rich(&conversation_id, &reply).await
    } else {
        channel.send_message(&conversation_id, &reply).await
    };
    if let Err(err) = sent {
        warn!(
            channel = platform,
            chat_id = %conversation_id,
            %err,
            "failed to deliver channel reply"
        );
        return;
    }

    // 8. Optional spoken reply, alongside (never instead of) the text — a voice
    //    note the user cannot skim is worse than one they can.
    if runtime.cfg.voice_reply.should_speak(message.is_voice()) && channel.caps().voice {
        let delivery = media::wav_delivery(platform);
        if delivery == VoiceDelivery::Unsupported {
            warn!(
                channel = platform,
                "voice reply requested but the platform cannot carry Core's WAV output"
            );
        } else {
            match media::speak(&runtime.http, &runtime.cfg.core_url, &reply).await {
                Ok(wav) => {
                    if let Err(err) = channel.send_voice(&conversation_id, wav, delivery).await {
                        warn!(channel = platform, %err, "failed to deliver spoken reply");
                    }
                }
                Err(err) => warn!(channel = platform, %err, "speech synthesis failed"),
            }
        }
    }
}

// NOTE: the legacy `handle_message(&C, host, InboundMessage)` entry point is
// deliberately GONE rather than kept as a deprecated shim. It could not honestly
// be made backwards compatible: the shared path now runs the pairing gate, media
// ingest and thread packing, so a "compatible" shim would have quietly changed
// the behaviour of every caller that kept using it — including gating inbound
// that used to flow. Deleting it turns that into a compile error at each call
// site, which is where the decision belongs. Every adapter calls `handle_turn`.

/// Spawn one channel's inbound loop on a dedicated task. A channel that fails to
/// construct or whose loop errors is logged and skipped so it never takes down
/// the gateway or any sibling channel.
pub fn spawn_channel<C: Channel + 'static>(
    host: &Arc<dyn ChannelHost>,
    channel: anyhow::Result<C>,
) {
    match channel {
        Ok(channel) => {
            let channel = Arc::new(channel);
            let name = channel.name();
            let access = &channel.runtime().cfg.access;
            match access.dm {
                DmPolicy::Open => warn!(
                    channel = name,
                    "channel registered in OPEN mode — every DM is answered and billed to this operator"
                ),
                DmPolicy::Pairing => info!(
                    channel = name,
                    "channel registered with DM pairing — unknown senders get a code to be approved"
                ),
                DmPolicy::Allowlist | DmPolicy::Disabled => {}
            }
            info!(channel = name, "registering channel");
            let host = Arc::clone(host);
            tokio::spawn(async move {
                if let Err(err) = channel.clone().run(host).await {
                    warn!(channel = name, error = %err, "channel loop exited with error");
                }
            });
        }
        Err(err) => {
            warn!(error = %err, "failed to register channel");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_request_body_includes_user_message() {
        let body = build_request_body("gpt-4o", None, "hello");
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["stream"], false);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hello");
    }

    #[test]
    fn build_request_body_prepends_system_prompt() {
        let body = build_request_body("gpt-4o", Some("be terse"), "hi");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "be terse");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn extract_reply_reads_first_choice() {
        let response = json!({
            "choices": [
                { "message": { "role": "assistant", "content": "the answer" } }
            ]
        });
        assert_eq!(extract_reply(&response).as_deref(), Some("the answer"));
    }

    #[test]
    fn extract_reply_none_when_missing() {
        let response = json!({ "choices": [] });
        assert!(extract_reply(&response).is_none());
    }

    #[test]
    fn thread_packing_round_trips() {
        let packed = pack_thread("C123", Some("111.222"));
        assert_eq!(packed, "C123:111.222");
        assert_eq!(unpack_thread(&packed), ("C123", Some("111.222")));

        // No thread ⇒ the chat id is unchanged and unpacks to itself.
        let bare = pack_thread("C123", None);
        assert_eq!(bare, "C123");
        assert_eq!(unpack_thread(&bare), ("C123", None));

        // An empty thread id must not produce a trailing separator.
        assert_eq!(pack_thread("C123", Some("")), "C123");
    }

    #[test]
    fn unpack_thread_splits_on_the_last_separator() {
        // A chat id containing a colon still survives the round trip.
        let packed = pack_thread("a:b", Some("t1"));
        assert_eq!(unpack_thread(&packed), ("a:b", Some("t1")));
    }

    #[test]
    fn env_policy_maps_the_three_legacy_states() {
        // An allowlist locks both DMs and groups to it.
        let listed = policy_from(Some(vec!["123".into()]), false);
        assert_eq!(listed.dm, DmPolicy::Allowlist);
        assert_eq!(listed.group, GroupPolicy::Allowlist);
        assert_eq!(listed.dm_allowlist, vec!["123".to_string()]);

        // ALLOW_ALL with no list opens both.
        let open = policy_from(None, true);
        assert_eq!(open.dm, DmPolicy::Open);
        assert_eq!(open.group, GroupPolicy::Open);

        // Nothing configured ⇒ DMs pair, groups stay closed (empty allowlist).
        let bare = policy_from(None, false);
        assert_eq!(bare.dm, DmPolicy::Pairing);
        assert_eq!(bare.group, GroupPolicy::Allowlist);
        assert_eq!(bare.decide_group("anything"), Decision::Deny);
    }

    #[test]
    fn allow_all_only_accepts_explicit_enable_tokens() {
        assert!(!channel_allow_all_from(None));
        for v in ["0", "false", "off", "no", ""] {
            assert!(
                !channel_allow_all_from(Some(v)),
                "{v:?} must not open the channel"
            );
        }
        for v in ["1", "true", "yes", "on", " 1 ", "TRUE"] {
            assert!(
                channel_allow_all_from(Some(v)),
                "{v:?} should opt into open mode"
            );
        }
    }

    /// Build a runtime with a given access policy, for the admission tests.
    fn runtime_with(access: AccessPolicy) -> ChannelRuntime {
        ChannelRuntime::new(
            reqwest::Client::new(),
            CommonChannelConfig {
                access,
                ..Default::default()
            },
            PairingStore::ephemeral(),
            None,
        )
    }

    fn dm_from(sender: &str) -> InboundMessage {
        let mut m = InboundMessage::text("chat-1", "hi");
        m.sender_id = Some(sender.to_string());
        m
    }

    /// The read-only gate must never mint a pairing code — that is the whole
    /// reason it exists rather than reusing `decide_dm`.
    #[tokio::test]
    async fn already_admitted_does_not_mint_a_code() {
        let runtime = runtime_with(AccessPolicy {
            dm: DmPolicy::Pairing,
            ..Default::default()
        });
        let message = dm_from("stranger");

        assert!(!runtime.already_admitted("telegram", &message).await);
        assert!(
            runtime.pairing.get("telegram", "stranger").await.is_none(),
            "the read-only check must not create pairing state"
        );

        // Once the operator approves them, the same check admits them.
        runtime.pairing.approve("telegram", "stranger").await;
        assert!(runtime.already_admitted("telegram", &message).await);
    }

    #[tokio::test]
    async fn already_admitted_matches_the_policy_for_each_dm_mode() {
        let open = runtime_with(AccessPolicy {
            dm: DmPolicy::Open,
            ..Default::default()
        });
        assert!(open.already_admitted("t", &dm_from("anyone")).await);

        let off = runtime_with(AccessPolicy {
            dm: DmPolicy::Disabled,
            ..Default::default()
        });
        assert!(!off.already_admitted("t", &dm_from("anyone")).await);

        // A listed sender is admitted whatever the mode, exactly as the real gate.
        let listed = runtime_with(AccessPolicy {
            dm: DmPolicy::Pairing,
            dm_allowlist: vec!["vip".into()],
            ..Default::default()
        });
        assert!(listed.already_admitted("t", &dm_from("vip")).await);
        assert!(!listed.already_admitted("t", &dm_from("other")).await);
    }

    #[tokio::test]
    async fn already_admitted_uses_the_group_rules_for_group_messages() {
        let runtime = runtime_with(AccessPolicy {
            group: GroupPolicy::Allowlist,
            group_allowlist: vec!["room-1".into()],
            // A wide-open DM policy must not leak into the group decision.
            dm: DmPolicy::Open,
            ..Default::default()
        });

        let mut allowed = InboundMessage::text("room-1", "hi");
        allowed.is_group = true;
        assert!(runtime.already_admitted("t", &allowed).await);

        let mut denied = InboundMessage::text("room-2", "hi");
        denied.is_group = true;
        assert!(
            !runtime.already_admitted("t", &denied).await,
            "an unlisted room must not inherit the open DM policy"
        );
    }

    #[test]
    fn inbound_identity_prefers_the_sender_id() {
        let mut m = InboundMessage::text("chat-1", "hi");
        assert_eq!(m.identity(), "chat-1");
        m.sender_id = Some("user-9".into());
        assert_eq!(m.identity(), "user-9");
    }

    #[test]
    fn bot_profile_clips_to_platform_limits() {
        let profile = BotProfile {
            name: Some("n".repeat(100)),
            short_bio: Some("s".repeat(300)),
            description: Some("d".repeat(900)),
        };
        let clipped = profile.clipped();
        assert_eq!(clipped.name.unwrap().chars().count(), 64);
        assert_eq!(clipped.short_bio.unwrap().chars().count(), 120);
        assert_eq!(clipped.description.unwrap().chars().count(), 512);
        assert!(BotProfile::default().is_empty());
    }

    /// Channel allowlist env reading. Run as ONE sequential test because it
    /// mutates process-global env; parallel sub-tests would race.
    #[test]
    fn channel_allowlist_reads_env() {
        std::env::remove_var("RYU_CHANNEL_ALLOWED_USERS");
        std::env::remove_var("RYU_CHANNEL_ALLOWED_USERS_TELEGRAM");

        assert!(channel_allowlist("telegram").is_none());

        std::env::set_var("RYU_CHANNEL_ALLOWED_USERS_TELEGRAM", "123, 456");
        assert_eq!(
            channel_allowlist("telegram"),
            Some(vec!["123".to_string(), "456".to_string()])
        );
        // A different platform with no list of its own sees nothing.
        assert!(channel_allowlist("slack").is_none());

        // Global applies when per-platform is unset.
        std::env::remove_var("RYU_CHANNEL_ALLOWED_USERS_TELEGRAM");
        std::env::set_var("RYU_CHANNEL_ALLOWED_USERS", "777");
        assert_eq!(channel_allowlist("telegram"), Some(vec!["777".to_string()]));

        // Per-platform OVERRIDES global.
        std::env::set_var("RYU_CHANNEL_ALLOWED_USERS_TELEGRAM", "123");
        assert_eq!(channel_allowlist("telegram"), Some(vec!["123".to_string()]));

        std::env::remove_var("RYU_CHANNEL_ALLOWED_USERS");
        std::env::remove_var("RYU_CHANNEL_ALLOWED_USERS_TELEGRAM");
    }
}
