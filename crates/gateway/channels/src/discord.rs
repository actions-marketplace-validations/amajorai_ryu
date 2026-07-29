//! Discord channel adapter.
//!
//! A Discord bot normally receives messages over the Gateway WebSocket. To stay
//! consistent with the dependency-light, long-poll transport used by the
//! [`telegram`](super::telegram) adapter, this adapter polls each watched
//! channel's REST message history with an `after` cursor — the same
//! advance-the-offset trick Telegram's `getUpdates` uses, so nothing is ever
//! re-delivered. Everything after "a message arrived" is the shared path:
//! [`handle_turn`] gates it, folds in media, runs it through Core's session seam
//! (or the legacy gateway pipeline) and delivers the reply, so this file owns only
//! the poll transport plus Discord's own verbs.
//!
//! # What the REST-poll transport cannot do
//!
//! Two Discord features are deliberately absent because they are unreachable from
//! a poller, and a half-working version of either is worse than none:
//!
//! - **Slash commands.** Registering application commands is a plain REST call, but
//!   *invoking* one delivers an INTERACTION — over an interactions webhook on a
//!   public HTTPS endpoint, or over an identified Gateway WebSocket. This adapter
//!   has neither, so a registered menu would show entries that fail with "the
//!   application did not respond" when clicked. [`Channel::publish_commands`] is
//!   therefore left as the kernel's no-op and [`ChannelCaps::command_menu`] is
//!   false. Commands still work when *typed*: `/goal ship it` is ordinary message
//!   content that reaches Core intact and is dispatched there like any other
//!   surface's. Lifting this needs either a public interactions URL (and Ed25519
//!   request verification) or a Gateway WebSocket connection.
//! - **Presence (the green dot).** A bot's online status is a property of an
//!   identified Gateway WebSocket session; there is no REST endpoint that sets it,
//!   so a REST-poll bot always renders offline in the member list. Ryu's own
//!   liveness signal ([`StatusReporter`], heartbeated from the poll loop
//!   below) already answers "is this bot running", which is the question an
//!   operator actually has.
//!
//! Related: only the configured `channel_ids` are polled. A thread this adapter
//! opens is a *separate* channel, so the reply lands in the thread and Core keeps
//! that thread's own history, but a user's follow-up typed **inside** the thread is
//! not picked up — answering there needs the poll set to grow at runtime (a shared
//! mutable channel set written from the spawned turn tasks), which is a larger
//! change than it looks and is left for the Gateway-WebSocket transport.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{debug, warn};

use crate::media::{self, Attachment, AttachmentKind, VoiceDelivery};
use crate::pairing::PairingStore;
use crate::status::StatusReporter;
use crate::{
    handle_turn, pack_thread, unpack_thread, BotProfile, Channel, ChannelCaps, ChannelHost,
    ChannelRuntime, DiscordChannelConfig, GroupReplyMode, InboundMessage,
};

/// Minimum spacing between `online` heartbeats. The poll loop runs every 2s, so
/// this throttles the report to roughly one every 20s while healthy.
const HEARTBEAT_MIN_SPACING: Duration = Duration::from_secs(20);

/// Discord REST API base. Pinned to v10 (the current stable version).
const API_BASE: &str = "https://discord.com/api/v10";

/// Interval between message-history polls per watched channel.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Cooldown before retrying after a transport error, so a flaky network or a
/// transient Discord outage doesn't become a tight failure loop.
const ERROR_BACKOFF: Duration = Duration::from_secs(3);

/// Max messages fetched per poll (Discord caps this at 100).
const FETCH_LIMIT: u8 = 50;

/// Timeout for one REST call. Generous enough for a slow round trip, short enough
/// that a hung request cannot stall the poll loop for a watched channel.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Discord's per-message content ceiling. An agent reply routinely exceeds it, and
/// the API rejects the whole message rather than truncating, so replies are split
/// (see [`split_message`]).
const MAX_MESSAGE_CHARS: usize = 2000;

/// Longest thread name we build. Discord allows 100; keeping well under it means a
/// name derived from a user's first sentence stays readable in the sidebar.
const THREAD_NAME_CHARS: usize = 60;

/// Name used when the triggering message yields nothing nameable (an image with no
/// caption). Discord rejects an empty thread name outright.
const THREAD_NAME_FALLBACK: &str = "Ryu reply";

/// `auto_archive_duration` for created threads, in minutes. Must be one of
/// 60 / 1440 / 4320 / 10080; a day is the sane default for a conversation thread.
const THREAD_AUTO_ARCHIVE_MINUTES: u32 = 1440;

/// Filename used for a synthesized reply. The `.wav` extension is what makes
/// Discord render an inline player instead of a generic download chip.
const VOICE_FILENAME: &str = "reply.wav";

pub struct DiscordChannel {
    /// Core route, access policy, pairing store, status reporter — everything the
    /// shared inbound path needs.
    runtime: ChannelRuntime,
    token: String,
    /// Guild channels polled for new messages.
    channel_ids: Vec<String>,
    /// Answer inside a thread opened on the triggering message rather than in the
    /// channel itself. Gated inside [`Channel::open_thread`] rather than in
    /// [`Channel::caps`]: Discord *can* thread regardless, this is the operator's
    /// choice about whether it should.
    thread_replies: bool,
}

impl DiscordChannel {
    /// Build an adapter with no liveness reporting (env-configured bots).
    pub fn new(
        cfg: DiscordChannelConfig,
        http: reqwest::Client,
        pairing: PairingStore,
    ) -> anyhow::Result<Self> {
        Self::new_with_status(cfg, http, pairing, None)
    }

    /// Like [`Self::new`] but attaches a liveness reporter so the bot heartbeats
    /// its connection status back to the control plane.
    pub fn new_with_status(
        cfg: DiscordChannelConfig,
        http: reqwest::Client,
        pairing: PairingStore,
        status: Option<StatusReporter>,
    ) -> anyhow::Result<Self> {
        if cfg.token.trim().is_empty() {
            anyhow::bail!("discord channel token is empty");
        }
        if cfg.channel_ids.is_empty() {
            anyhow::bail!("discord channel requires at least one channel_id");
        }

        // Every watched channel is a guild (multi-user) channel, so the shared gate
        // decides it as a GROUP — and the default group policy is an allowlist that
        // starts empty, which would deny every message the operator explicitly
        // asked this bot to watch. Configuring `channel_ids` IS the operator
        // consent `GroupPolicy::Allowlist` is asking for, so fold them in. Harmless
        // under `Open`/`Disabled`, which never read the list.
        let mut common = cfg.common;
        for channel_id in &cfg.channel_ids {
            if !common
                .access
                .group_allowlist
                .iter()
                .any(|id| id == channel_id)
            {
                common.access.group_allowlist.push(channel_id.clone());
            }
        }

        Ok(Self {
            runtime: ChannelRuntime::new(http, common, pairing, status),
            token: cfg.token,
            channel_ids: cfg.channel_ids,
            thread_replies: cfg.thread_replies,
        })
    }

    fn auth_header(&self) -> String {
        format!("Bot {}", self.token)
    }

    fn http(&self) -> &reqwest::Client {
        &self.runtime.http
    }

    /// Fetch the bot's own user id (`GET /users/@me`) so mention detection can
    /// recognise `<@id>` mentions. Called once at the start of the poll loop; on
    /// failure the loop proceeds with an empty id — in `Mentions` mode that means
    /// no message matches (bot stays quiet) until the next restart.
    async fn get_me_id(&self) -> anyhow::Result<String> {
        let url = format!("{API_BASE}/users/@me");
        let resp = self
            .http()
            .get(&url)
            .header("Authorization", self.auth_header())
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        let me: DiscordUser = resp.json().await?;
        Ok(me.id)
    }

    /// Fetch messages newer than `after` (a Discord snowflake id) for one channel.
    /// When `after` is empty, fetch the most recent batch to establish a cursor.
    async fn fetch_messages(
        &self,
        channel_id: &str,
        after: Option<&str>,
    ) -> anyhow::Result<Vec<DiscordMessage>> {
        let url = format!("{API_BASE}/channels/{channel_id}/messages");
        let mut query: Vec<(&str, String)> = vec![("limit", FETCH_LIMIT.to_string())];
        if let Some(after) = after {
            query.push(("after", after.to_string()));
        }

        let resp = self
            .http()
            .get(&url)
            .header("Authorization", self.auth_header())
            .query(&query)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;

        let messages: Vec<DiscordMessage> = resp.json().await?;
        Ok(messages)
    }

    /// Post one chunk of content to a channel (or thread — a thread IS a channel).
    async fn post_content(&self, target: &str, content: &str) -> anyhow::Result<()> {
        let url = format!("{API_BASE}/channels/{target}/messages");
        self.http()
            .post(&url)
            .header("Authorization", self.auth_header())
            .json(&json!({ "content": content }))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Create a thread hanging off `message_id` and return the new thread's id.
    ///
    /// # Errors
    /// Returns `Err` when Discord refuses (missing `CREATE_PUBLIC_THREADS`, the
    /// message already has a thread, the channel type cannot host one) or the
    /// response carries no id.
    async fn create_thread(
        &self,
        channel_id: &str,
        message_id: &str,
        name: &str,
    ) -> anyhow::Result<String> {
        let url = format!("{API_BASE}/channels/{channel_id}/messages/{message_id}/threads");
        let resp = self
            .http()
            .post(&url)
            .header("Authorization", self.auth_header())
            .json(&json!({
                "name": name,
                "auto_archive_duration": THREAD_AUTO_ARCHIVE_MINUTES,
            }))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        let created: DiscordChannelRef = resp.json().await?;
        if created.id.is_empty() {
            anyhow::bail!("discord returned a thread with no id");
        }
        Ok(created.id)
    }

    /// Download the speech attachments on an inbound message so the shared path can
    /// transcribe them.
    ///
    /// Only speech is fetched: an image or a PDF is annotated by its filename
    /// (see [`media::annotate`]) and pulling its bytes would spend bandwidth on
    /// something nothing reads. Discord CDN links are pre-signed and public, so —
    /// importantly — the bot token is NOT sent with them. Every failure degrades to
    /// "this attachment contributes nothing", never to a dropped turn.
    async fn download_speech(&self, message: &InboundMessage) -> Vec<(usize, Vec<u8>)> {
        let mut downloaded = Vec::new();
        for (index, attachment) in message.attachments.iter().enumerate() {
            if !attachment.resolved_kind().is_speech() {
                continue;
            }
            let Some(url) = attachment.url.as_deref() else {
                continue;
            };
            // The declared size lets an oversized attachment be refused before the
            // bandwidth is spent on it.
            if attachment
                .size
                .is_some_and(|size| size as usize > media::MAX_ATTACHMENT_BYTES)
            {
                warn!(
                    size = attachment.size,
                    "discord attachment exceeds the size cap; skipping download"
                );
                continue;
            }
            match media::download(self.http(), url, &[]).await {
                Ok(bytes) => downloaded.push((index, bytes)),
                Err(err) => warn!(%err, "discord attachment download failed"),
            }
        }
        downloaded
    }
}

#[async_trait]
impl Channel for DiscordChannel {
    fn name(&self) -> &'static str {
        "discord"
    }

    fn runtime(&self) -> &ChannelRuntime {
        &self.runtime
    }

    /// Discord speaks typing indicators, threads, arbitrary file attachments and
    /// reactions.
    ///
    /// `rich_text` is deliberately FALSE: Discord message content already renders
    /// the markdown our replies are written in, so plain `content` *is* the rich
    /// surface. Claiming otherwise would send replies through [`Channel::send_rich`]
    /// for no behavioural difference. `command_menu` and `streaming` are false for
    /// the transport reasons in the module doc.
    fn caps(&self) -> ChannelCaps {
        ChannelCaps {
            typing: true,
            rich_text: false,
            streaming: false,
            threads: true,
            command_menu: false,
            voice: true,
            attachments: true,
            reactions: true,
        }
    }

    /// Discord's typing indicator lasts 10 seconds, so re-assert it a little under
    /// that rather than on the kernel's tighter Telegram-shaped default.
    fn typing_interval(&self) -> Duration {
        Duration::from_secs(8)
    }

    async fn send_message(&self, chat_id: &str, text: &str) -> anyhow::Result<()> {
        let target = target_channel(chat_id).to_string();
        for chunk in split_message(text, MAX_MESSAGE_CHARS) {
            self.post_content(&target, &chunk).await?;
        }
        Ok(())
    }

    async fn send_typing(&self, chat_id: &str) -> anyhow::Result<()> {
        let target = target_channel(chat_id);
        let url = format!("{API_BASE}/channels/{target}/typing");
        self.http()
            .post(&url)
            .header("Authorization", self.auth_header())
            // Discord requires a body on this POST; an empty JSON object is the
            // documented shape.
            .json(&json!({}))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Upload the synthesized WAV as a file attachment.
    ///
    /// Discord's true voice-message flag needs an OGG/Opus body plus a waveform,
    /// which Core's TTS does not produce — so [`media::wav_delivery`] reports
    /// [`VoiceDelivery::AudioFile`] and this sends a playable attachment instead of
    /// faking a voice bubble.
    async fn send_voice(
        &self,
        chat_id: &str,
        wav: Vec<u8>,
        delivery: VoiceDelivery,
    ) -> anyhow::Result<()> {
        if delivery == VoiceDelivery::Unsupported {
            anyhow::bail!("discord was asked to deliver audio it cannot carry");
        }
        let target = target_channel(chat_id);
        let url = format!("{API_BASE}/channels/{target}/messages");
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name(VOICE_FILENAME)
            .mime_str("audio/wav")?;
        let form = reqwest::multipart::Form::new()
            .text("payload_json", voice_payload(VOICE_FILENAME).to_string())
            .part("files[0]", part);
        self.http()
            .post(&url)
            .header("Authorization", self.auth_header())
            .multipart(form)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    async fn react(&self, chat_id: &str, message_id: &str, emoji: &str) -> anyhow::Result<()> {
        let target = target_channel(chat_id);
        let encoded = encode_emoji(emoji);
        let url =
            format!("{API_BASE}/channels/{target}/messages/{message_id}/reactions/{encoded}/@me");
        self.http()
            .put(&url)
            // Discord requires a length on this bodyless PUT; reqwest emits
            // `content-length: 0` for an empty body, so nothing else is needed.
            .body(Vec::new())
            .header("Authorization", self.auth_header())
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Push the operator's bot profile. Discord splits it across two objects: the
    /// bot USER carries the name, the APPLICATION carries the description shown on
    /// the app's profile. There is no equivalent of a short bio, so that field is
    /// left unpublished rather than crammed into the description.
    async fn publish_profile(&self, profile: &BotProfile) -> anyhow::Result<()> {
        if let Some(name) = profile.name.as_deref().filter(|n| !n.trim().is_empty()) {
            self.http()
                .patch(format!("{API_BASE}/users/@me"))
                .header("Authorization", self.auth_header())
                .json(&json!({ "username": name }))
                .timeout(REQUEST_TIMEOUT)
                .send()
                .await?
                .error_for_status()?;
        }
        if let Some(description) = profile
            .description
            .as_deref()
            .filter(|d| !d.trim().is_empty())
        {
            self.http()
                .patch(format!("{API_BASE}/applications/@me"))
                .header("Authorization", self.auth_header())
                .json(&json!({ "description": description }))
                .timeout(REQUEST_TIMEOUT)
                .send()
                .await?
                .error_for_status()?;
        }
        Ok(())
    }

    /// Answer inside a thread hung off the triggering message, keeping a busy
    /// channel readable and giving each exchange its own Core history (the packed
    /// key is the conversation id).
    ///
    /// Returns a conversation key, not a `Result`: a thread that could not be
    /// created must degrade to the parent channel, because losing the reply is far
    /// worse than losing the thread.
    async fn open_thread(&self, chat_id: &str, message: &InboundMessage) -> String {
        if !self.thread_replies {
            return chat_id.to_string();
        }
        let (channel_id, existing) = unpack_thread(chat_id);
        if existing.is_some() {
            // Already inside a thread — nest no further.
            return chat_id.to_string();
        }
        let Some(message_id) = message.message_id.as_deref() else {
            return chat_id.to_string();
        };
        let name = thread_name(&message.text);
        match self.create_thread(channel_id, message_id, &name).await {
            Ok(thread_id) => pack_thread(channel_id, Some(&thread_id)),
            Err(err) => {
                warn!(
                    channel_id = %channel_id,
                    %err,
                    "discord thread creation failed; answering in the parent channel"
                );
                chat_id.to_string()
            }
        }
    }

    async fn run(self: Arc<Self>, host: Arc<dyn ChannelHost>) -> anyhow::Result<()> {
        debug!("discord channel poll loop started");
        if let Some(reporter) = &self.runtime.status {
            reporter.connecting().await;
        }

        // Profile first: it is a one-shot REST call and an operator who set a name
        // expects to see it before the first message, not after. Best-effort —
        // Discord rate-limits username changes hard (2 per hour).
        let profile = self.runtime.cfg.profile.clipped();
        if !profile.is_empty() {
            if let Err(err) = self.publish_profile(&profile).await {
                warn!(%err, "discord profile publish failed");
            }
        }

        // Resolve the bot's own user id once so mention detection recognises
        // `<@id>`. Non-fatal on failure: in Mentions mode nothing matches (the
        // bot stays quiet) until restart; All mode is unaffected.
        let me_id = match self.get_me_id().await {
            Ok(id) => id,
            Err(err) => {
                warn!(
                    error = %err,
                    "discord get_me failed; mention detection disabled until restart"
                );
                String::new()
            }
        };
        // Per-channel cursor: the snowflake id of the last message we processed.
        // Discord ids are monotonically increasing, so `after` cleanly excludes
        // anything we've already handled.
        let mut cursors: HashMap<String, String> = HashMap::new();
        // Throttle `online` heartbeats — the poll loop is far faster than we need
        // to report liveness.
        let mut last_online: Option<Instant> = None;

        loop {
            for channel_id in &self.channel_ids {
                let after = cursors.get(channel_id).cloned();
                let is_seed_poll = after.is_none();
                match self.fetch_messages(channel_id, after.as_deref()).await {
                    Ok(mut messages) => {
                        // A successful fetch means the bot is live — heartbeat
                        // online, throttled so we don't spam the control plane.
                        if let Some(reporter) = &self.runtime.status {
                            let due =
                                last_online.map_or(true, |t| t.elapsed() >= HEARTBEAT_MIN_SPACING);
                            if due {
                                reporter.online().await;
                                last_online = Some(Instant::now());
                            }
                        }
                        // Discord returns newest-first; process oldest-first so
                        // the cursor advances correctly and replies stay ordered.
                        messages.reverse();
                        for message in messages {
                            cursors.insert(channel_id.clone(), message.id.clone());

                            // First poll only seeds the cursor; don't replay
                            // history that predates the bot starting up.
                            if is_seed_poll {
                                continue;
                            }

                            // Decide whether to reply: skips bot/empty messages,
                            // and in Mentions mode skips anything that doesn't
                            // @mention the bot. Returns the mention-stripped text
                            // to route, or None to ignore.
                            let Some(routed_text) =
                                decide_reply(&message, &me_id, self.runtime.cfg.group_reply_mode)
                            else {
                                continue;
                            };

                            let mut inbound = InboundMessage {
                                chat_id: channel_id.clone(),
                                text: routed_text,
                                // Attribution is a first-class field now, so the
                                // speaker is recorded on the turn rather than
                                // smuggled into the prompt text.
                                author_name: Some(message.author.username.clone())
                                    .filter(|n| !n.trim().is_empty()),
                                sender_id: Some(message.author.id.clone())
                                    .filter(|id| !id.is_empty()),
                                message_id: Some(message.id.clone()),
                                // A watched channel is a guild channel, i.e. always
                                // multi-user, so the group rules apply to all of it.
                                is_group: true,
                                attachments: parse_attachments(&message),
                            };

                            let channel = Arc::clone(&self);
                            let host = Arc::clone(&host);
                            tokio::spawn(async move {
                                let downloaded = channel.download_speech(&inbound).await;
                                if !downloaded.is_empty() {
                                    channel.runtime.ingest_media(&mut inbound, downloaded).await;
                                }
                                handle_turn(channel, host, inbound).await;
                            });
                        }
                    }
                    Err(err) => {
                        warn!(
                            channel_id = %channel_id,
                            error = %err,
                            "discord message fetch failed, backing off"
                        );
                        if let Some(reporter) = &self.runtime.status {
                            reporter.error(&err.to_string()).await;
                        }
                        tokio::time::sleep(ERROR_BACKOFF).await;
                    }
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/// The channel a conversation key addresses: the thread when the key carries one,
/// otherwise the room itself.
///
/// A Discord thread *is* a channel — messages, typing and reactions inside it all
/// post to the thread id — so every outbound verb resolves the key through here.
/// Snowflakes contain no colon, so [`unpack_thread`]'s split is unambiguous.
fn target_channel(packed: &str) -> &str {
    let (channel_id, thread_id) = unpack_thread(packed);
    thread_id.unwrap_or(channel_id)
}

/// Split a reply into chunks Discord will accept.
///
/// Discord rejects a message over [`MAX_MESSAGE_CHARS`] outright rather than
/// truncating, and an agent answer routinely runs longer. Splitting happens on line
/// boundaries so lists and short code blocks stay intact; a single line longer than
/// the ceiling is hard-split because nothing else can be done with it. A fenced
/// block that itself spans the boundary is still severed (the first chunk ends
/// unclosed) — tracking fence state across chunks is more machinery than the
/// rendering glitch is worth.
fn split_message(text: &str, max: usize) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut buf_len = 0usize;

    for line in text.split_inclusive('\n') {
        let line_len = line.chars().count();
        if line_len > max {
            if buf_len > 0 {
                chunks.push(std::mem::take(&mut buf));
                buf_len = 0;
            }
            for ch in line.chars() {
                if buf_len == max {
                    chunks.push(std::mem::take(&mut buf));
                    buf_len = 0;
                }
                buf.push(ch);
                buf_len += 1;
            }
            continue;
        }
        if buf_len + line_len > max {
            chunks.push(std::mem::take(&mut buf));
            buf_len = 0;
        }
        buf.push_str(line);
        buf_len += line_len;
    }
    if buf_len > 0 {
        chunks.push(buf);
    }
    // A blank chunk would be rejected by Discord ("content: must not be empty"),
    // so drop anything that is only whitespace.
    chunks.retain(|chunk| !chunk.trim().is_empty());
    chunks
}

/// Derive a thread name from the user's message.
///
/// Control characters are dropped and whitespace collapsed before clipping, so a
/// pasted multi-line prompt still yields one readable line. Falls back to
/// [`THREAD_NAME_FALLBACK`] because Discord rejects an empty name — an image sent
/// with no caption must still get a thread.
fn thread_name(text: &str) -> String {
    let cleaned: String = text.chars().filter(|ch| !ch.is_control()).collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let clipped: String = collapsed.chars().take(THREAD_NAME_CHARS).collect();
    let trimmed = clipped.trim();
    if trimmed.is_empty() {
        THREAD_NAME_FALLBACK.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Percent-encode an emoji for the reactions path segment.
///
/// Hand-rolled rather than pulling an encoder in for one call site. `:` is left
/// intact on purpose: a custom emoji is addressed as `name:id`, and encoding the
/// separator turns a valid custom reaction into a 400.
fn encode_emoji(emoji: &str) -> String {
    let mut out = String::with_capacity(emoji.len() * 3);
    for byte in emoji.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// The `payload_json` half of a file upload. Discord maps a `files[N]` part to an
/// entry in `attachments` by its `id`, so the two must agree or the upload is
/// accepted with no attachment on it.
fn voice_payload(filename: &str) -> Value {
    json!({
        "content": "",
        "attachments": [{ "id": 0, "filename": filename }],
    })
}

/// Normalise Discord's attachment array into the kernel's shape.
///
/// Discord serves media from a pre-signed CDN URL, so `url` is set and `file_id`
/// stays empty (no resolve step). `duration_secs` is present only on a true voice
/// message, which is what distinguishes a push-to-talk recording from an uploaded
/// song; everything else is classified from its MIME type.
fn parse_attachments(message: &DiscordMessage) -> Vec<Attachment> {
    message
        .attachments
        .iter()
        .map(|a| Attachment {
            kind: a.duration_secs.map(|_| AttachmentKind::Voice),
            url: Some(a.url.clone()).filter(|u| !u.is_empty()),
            file_id: None,
            mime: a.content_type.clone().filter(|m| !m.is_empty()),
            filename: Some(a.filename.clone()).filter(|f| !f.is_empty()),
            size: a.size,
        })
        .collect()
}

/// Decide whether — and in what form — to route an inbound Discord message.
///
/// Watched channels are always multi-user (guild) channels, so `mode` applies to
/// all of them: `Mentions` only answers when the bot is `<@id>` mentioned; `All`
/// answers every (non-bot) message. The bot's own mention is stripped so the agent
/// sees a clean prompt; the speaker is carried separately in
/// [`InboundMessage::author_name`] rather than prefixed into the text.
///
/// Returns the text to route — possibly EMPTY when the message is media-only, since
/// the transcript or the attachment note becomes the prompt downstream — or `None`
/// to ignore the message (bot author, nothing at all, or unaddressed in Mentions
/// mode).
fn decide_reply(message: &DiscordMessage, me_id: &str, mode: GroupReplyMode) -> Option<String> {
    // Ignore bot messages (including our own replies) to avoid self-talk.
    if message.author.bot.unwrap_or(false) {
        return None;
    }
    let content = message.content.trim();
    // A voice note or a photo arrives with no content at all; dropping it here
    // would make media ingest unreachable.
    if content.is_empty() && message.attachments.is_empty() {
        return None;
    }

    let mentioned = !me_id.is_empty()
        && (message.mentions.iter().any(|user| user.id == me_id)
            || content.contains(&format!("<@{me_id}>"))
            || content.contains(&format!("<@!{me_id}>")));

    if mode == GroupReplyMode::Mentions && !mentioned {
        return None;
    }

    // Strip the bot's own mention so the agent sees a clean prompt.
    let stripped = if me_id.is_empty() {
        content.to_string()
    } else {
        content
            .replace(&format!("<@{me_id}>"), "")
            .replace(&format!("<@!{me_id}>"), "")
    };
    let stripped = stripped.trim();
    if stripped.is_empty() && message.attachments.is_empty() {
        return None;
    }
    Some(stripped.to_string())
}

// ─── Discord REST API response types (only the fields we use) ──────────────────

#[derive(Debug, Deserialize)]
struct DiscordMessage {
    id: String,
    #[serde(default)]
    content: String,
    author: DiscordUser,
    /// Users explicitly mentioned in the message — the authoritative source for
    /// detecting whether the bot was addressed.
    #[serde(default)]
    mentions: Vec<DiscordUser>,
    #[serde(default)]
    attachments: Vec<DiscordAttachment>,
}

#[derive(Debug, Deserialize)]
struct DiscordUser {
    #[serde(default)]
    id: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    bot: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DiscordAttachment {
    #[serde(default)]
    url: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    /// Present only on a true voice message; its presence is how a push-to-talk
    /// recording is told apart from an uploaded audio file.
    #[serde(default)]
    duration_secs: Option<f64>,
}

/// A created thread, of which only the id is needed.
#[derive(Debug, Deserialize)]
struct DiscordChannelRef {
    #[serde(default)]
    id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pairing::Decision;
    use crate::CommonChannelConfig;

    fn make_cfg(token: &str, channel_ids: Vec<String>) -> DiscordChannelConfig {
        DiscordChannelConfig {
            token: token.to_string(),
            channel_ids,
            thread_replies: false,
            common: CommonChannelConfig {
                model: "gpt-4o".to_string(),
                ..Default::default()
            },
        }
    }

    fn build(cfg: DiscordChannelConfig) -> anyhow::Result<DiscordChannel> {
        DiscordChannel::new(cfg, reqwest::Client::new(), PairingStore::ephemeral())
    }

    fn msg(content: &str, mentions: Vec<&str>) -> DiscordMessage {
        DiscordMessage {
            id: "1".to_string(),
            content: content.to_string(),
            author: DiscordUser {
                id: "user-1".to_string(),
                username: "Ada".to_string(),
                bot: Some(false),
            },
            mentions: mentions
                .into_iter()
                .map(|id| DiscordUser {
                    id: id.to_string(),
                    username: String::new(),
                    bot: None,
                })
                .collect(),
            attachments: Vec::new(),
        }
    }

    const BOT_ID: &str = "999";

    #[test]
    fn ignores_bot_authored_messages() {
        let mut message = msg("hi", vec![]);
        message.author.bot = Some(true);
        assert!(decide_reply(&message, BOT_ID, GroupReplyMode::All).is_none());
    }

    #[test]
    fn mentions_mode_ignores_unaddressed_message() {
        let message = msg("just chatting", vec![]);
        assert!(decide_reply(&message, BOT_ID, GroupReplyMode::Mentions).is_none());
    }

    #[test]
    fn mentions_mode_replies_when_mentioned_and_strips_mention() {
        let message = msg("<@999> what is 2+2", vec![BOT_ID]);
        let routed = decide_reply(&message, BOT_ID, GroupReplyMode::Mentions);
        // The speaker is no longer prefixed into the text — it travels as
        // `author_name` on the inbound message instead.
        assert_eq!(routed.as_deref(), Some("what is 2+2"));
    }

    #[test]
    fn mentions_mode_detects_nickname_mention_form() {
        // `<@!id>` is the nickname mention form; both must be recognised/stripped.
        let message = msg("<@!999> hello", vec![]);
        let routed = decide_reply(&message, BOT_ID, GroupReplyMode::Mentions);
        assert_eq!(routed.as_deref(), Some("hello"));
    }

    #[test]
    fn all_mode_replies_to_every_message() {
        let message = msg("just chatting", vec![]);
        let routed = decide_reply(&message, BOT_ID, GroupReplyMode::All);
        assert_eq!(routed.as_deref(), Some("just chatting"));
    }

    #[test]
    fn empty_bot_id_disables_mention_detection() {
        let message = msg("<@999> hi", vec!["999"]);
        assert!(decide_reply(&message, "", GroupReplyMode::Mentions).is_none());
        // All mode still routes (mention detection irrelevant).
        assert_eq!(
            decide_reply(&message, "", GroupReplyMode::All).as_deref(),
            Some("<@999> hi")
        );
    }

    #[test]
    fn media_only_message_is_routed_with_empty_text() {
        // A voice note has no content; dropping it here would make transcription
        // unreachable, so it must survive with empty text.
        let mut message = msg("", vec![]);
        message.attachments.push(DiscordAttachment {
            url: "https://cdn.discordapp.com/a/voice.ogg".to_string(),
            filename: "voice-message.ogg".to_string(),
            content_type: Some("audio/ogg".to_string()),
            size: Some(1024),
            duration_secs: Some(3.5),
        });
        assert_eq!(
            decide_reply(&message, BOT_ID, GroupReplyMode::All).as_deref(),
            Some("")
        );
        // With neither text nor media there is nothing to route.
        let empty = msg("   ", vec![]);
        assert!(decide_reply(&empty, BOT_ID, GroupReplyMode::All).is_none());
    }

    #[test]
    fn new_rejects_empty_token() {
        assert!(build(make_cfg("  ", vec!["123".to_string()])).is_err());
    }

    #[test]
    fn new_rejects_missing_channels() {
        assert!(build(make_cfg("abc", vec![])).is_err());
    }

    #[test]
    fn builds_auth_header_and_metadata() {
        let mut cfg = make_cfg("secret", vec!["123".to_string()]);
        cfg.common.system_prompt = Some("be nice".to_string());
        let channel = build(cfg).unwrap();
        assert_eq!(channel.auth_header(), "Bot secret");
        assert_eq!(channel.name(), "discord");
        assert_eq!(channel.model(), "gpt-4o");
        assert_eq!(channel.system_prompt(), Some("be nice"));
    }

    #[test]
    fn new_stores_agent_id_and_core_url() {
        let mut cfg = make_cfg("tok:1", vec!["chan1".to_string()]);
        cfg.common.agent_id = Some("acp:pi".to_string());
        let channel = build(cfg).unwrap();
        assert_eq!(channel.runtime.cfg.agent_id.as_deref(), Some("acp:pi"));
        assert_eq!(channel.runtime.cfg.core_url, "http://127.0.0.1:7980");
        assert!(channel.runtime.routes_via_core());
    }

    /// Configuring a channel to poll IS the operator consent the group allowlist
    /// asks for. Without this the default policy (allowlist, empty) would deny
    /// every message in the very channels the bot was told to watch.
    #[test]
    fn watched_channels_are_admitted_by_the_group_gate() {
        let channel = build(make_cfg("t", vec!["chan1".to_string()])).unwrap();
        let access = &channel.runtime.cfg.access;
        assert_eq!(access.decide_group("chan1"), Decision::Allow);
        // An unwatched channel is still refused.
        assert_eq!(access.decide_group("chan2"), Decision::Deny);
    }

    #[test]
    fn caps_declare_only_what_the_poll_transport_can_do() {
        let channel = build(make_cfg("t", vec!["c".to_string()])).unwrap();
        let caps = channel.caps();
        assert!(caps.typing && caps.threads && caps.voice && caps.attachments && caps.reactions);
        // Discord content already renders our markdown; there is no separate rich
        // surface to claim.
        assert!(!caps.rich_text);
        // Slash commands need an interactions endpoint or a Gateway socket.
        assert!(!caps.command_menu);
        assert!(!caps.streaming);
        // The indicator lasts 10s, so it must be re-asserted under that.
        assert!(channel.typing_interval() < Duration::from_secs(10));
    }

    /// A thread IS a channel, so every outbound verb must address the thread when
    /// the conversation key carries one — using the parent would silently defeat
    /// threaded replies.
    #[test]
    fn conversation_key_resolves_to_the_thread() {
        let packed = pack_thread("111", Some("222"));
        assert_eq!(packed, "111:222");
        assert_eq!(target_channel(&packed), "222");
        // An unthreaded key addresses the channel itself.
        assert_eq!(target_channel("111"), "111");
    }

    #[test]
    fn thread_names_are_sanitised_and_clipped() {
        assert_eq!(thread_name("  hello   world\n"), "hello world");
        // Control characters never reach Discord.
        assert_eq!(thread_name("a\u{7}b"), "ab");
        // Long prompts are clipped to a readable single line.
        let long = thread_name(&"x".repeat(200));
        assert_eq!(long.chars().count(), THREAD_NAME_CHARS);
        assert!(THREAD_NAME_CHARS <= 100, "Discord caps thread names at 100");
        // An uncaptioned image must still yield a nameable thread.
        assert_eq!(thread_name("   "), THREAD_NAME_FALLBACK);
        assert_eq!(thread_name(""), THREAD_NAME_FALLBACK);
    }

    #[test]
    fn emoji_encoding_keeps_the_custom_emoji_separator() {
        // A multi-byte unicode emoji is fully percent-encoded.
        assert_eq!(encode_emoji("👍"), "%F0%9F%91%8D");
        // A custom emoji is `name:id`; encoding the colon would 400.
        assert_eq!(encode_emoji("ryu:12345"), "ryu:12345");
        assert_eq!(encode_emoji("a b"), "a%20b");
    }

    #[test]
    fn long_replies_split_on_line_boundaries() {
        let text = format!("{}\n{}", "a".repeat(1500), "b".repeat(900));
        let chunks = split_message(&text, MAX_MESSAGE_CHARS);
        assert_eq!(
            chunks.len(),
            2,
            "the two lines must not be merged over 2000"
        );
        assert!(chunks
            .iter()
            .all(|c| c.chars().count() <= MAX_MESSAGE_CHARS));
        assert!(chunks[0].starts_with('a') && chunks[1].starts_with('b'));

        // A single overlong line has no boundary to split on, so it is hard-split.
        let one_line = "z".repeat(4100);
        let hard = split_message(&one_line, MAX_MESSAGE_CHARS);
        assert_eq!(hard.len(), 3);
        assert_eq!(hard.iter().map(|c| c.chars().count()).sum::<usize>(), 4100);

        // Short text is one chunk; blank text produces no request at all.
        assert_eq!(
            split_message("hi", MAX_MESSAGE_CHARS),
            vec!["hi".to_string()]
        );
        assert!(split_message("   \n\n", MAX_MESSAGE_CHARS).is_empty());
    }

    #[test]
    fn voice_payload_maps_the_file_part_to_an_attachment() {
        let payload = voice_payload(VOICE_FILENAME);
        assert_eq!(payload["attachments"][0]["id"], 0);
        assert_eq!(payload["attachments"][0]["filename"], VOICE_FILENAME);
    }

    #[test]
    fn parses_messages_response() {
        let raw = json!([
            {
                "id": "555",
                "content": "hello bot",
                "author": { "bot": false }
            },
            {
                "id": "556",
                "content": "i am a bot",
                "author": { "bot": true }
            }
        ]);
        let parsed: Vec<DiscordMessage> = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "555");
        assert_eq!(parsed[0].content, "hello bot");
        assert_eq!(parsed[0].author.bot, Some(false));
        assert_eq!(parsed[1].author.bot, Some(true));
        assert!(parsed[0].attachments.is_empty());
    }

    #[test]
    fn parses_attachments_into_kernel_shape() {
        let raw = json!({
            "id": "1",
            "content": "",
            "author": { "id": "u1", "username": "Ada", "bot": false },
            "attachments": [
                {
                    "url": "https://cdn.discordapp.com/a/voice-message.ogg",
                    "filename": "voice-message.ogg",
                    "content_type": "audio/ogg",
                    "size": 4096,
                    "duration_secs": 2.25
                },
                {
                    "url": "https://cdn.discordapp.com/a/cat.png",
                    "filename": "cat.png",
                    "content_type": "image/png",
                    "size": 9001
                }
            ]
        });
        let message: DiscordMessage = serde_json::from_value(raw).unwrap();
        let parsed = parse_attachments(&message);
        assert_eq!(parsed.len(), 2);

        // `duration_secs` marks a true voice message, which is what gets transcribed.
        assert_eq!(parsed[0].resolved_kind(), AttachmentKind::Voice);
        assert!(parsed[0].resolved_kind().is_speech());
        assert_eq!(parsed[0].safe_filename(), "voice-message.ogg");
        assert_eq!(parsed[0].size, Some(4096));
        assert!(
            parsed[0].file_id.is_none(),
            "discord serves a direct CDN url"
        );

        // Everything else is classified from its MIME type and never transcribed.
        assert_eq!(parsed[1].resolved_kind(), AttachmentKind::Image);
        assert!(!parsed[1].resolved_kind().is_speech());
    }
}
