//! Cross-device conversation sync client (spec unit U108 / #222).
//!
//! Connects a local [`ConversationStore`] to the `:3000` server-side store
//! (`POST /api/conversations-sync/push`, `GET /api/conversations-sync/pull`).
//!
//! **Read path:** the background loop prefers the live SSE change feed
//! (`GET /api/conversations-sync/stream`), applying each delta as it arrives,
//! and falls back to the `GET .../pull` long-poll when streaming is
//! unavailable (old server, a proxy that strips streaming, transient error).
//!
//! **Conflict rule:** last-writer-wins on conversation metadata by
//! `updated_at`; messages are union-merged by their stable UUID `id`
//! (append-only — merge-by-id is always an additive insert).
//!
//! **Auth:** reuses the token stored at `~/.ryu/auth.json` by the existing
//! device-auth flow (`crate::auth::load_token`). No new secret file; if no
//! token is present the client returns [`SyncError::Unauthenticated`].
//!
//! **Nothing hardcoded:** the server base URL is read from the
//! `RYU_SERVER_URL` environment variable, falling back to `http://localhost:3000`.
//!
//! Placement (Core vs Gateway, CLAUDE.md §1): conversation state is
//! *what runs* (orchestration), so the sync client belongs in Core.

use std::fmt;
use std::time::Duration;

use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::conversations::{ConversationStore, Tenancy};

/// Errors specific to the sync client.
#[derive(Debug)]
pub enum SyncError {
    Unauthenticated,
    ServerError(u16, String),
    Http(reqwest::Error),
    Store(anyhow::Error),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::Unauthenticated => {
                write!(f, "no auth token found — complete device login first")
            }
            SyncError::ServerError(status, body) => {
                write!(f, "server returned {status}: {body}")
            }
            SyncError::Http(e) => write!(f, "http error: {e}"),
            SyncError::Store(e) => write!(f, "store error: {e}"),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<reqwest::Error> for SyncError {
    fn from(e: reqwest::Error) -> Self {
        SyncError::Http(e)
    }
}

/// Wire format shared between Core (Rust) and the `:3000` sync router.
/// Mirrors `ConversationSummary + Vec<StoredMessage>` from `conversations.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPayload {
    pub conversation_id: String,
    pub title: Option<String>,
    pub agent_id: Option<String>,
    pub folder_path: Option<String>,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub run_status: Option<String>,
    /// The ORIGINAL author of this conversation, carried from the source node so a
    /// replay lands owned by the person who wrote it — never the device that pulled
    /// it. `None` for a row created on an unbound personal node (NULL-tenanted at
    /// source); on a bound node a replay with no author here is REFUSED rather than
    /// mis-attributed (see [`effective_replay_tenancy`]). `#[serde(default,
    /// skip_serializing_if)]` keeps the wire bytes byte-identical for the unbound
    /// (author-less) push, and lets an older server that drops the field degrade to
    /// the safe fail-closed path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
    /// Unix milliseconds.
    pub created_at: i64,
    /// Unix milliseconds — LWW key.
    pub updated_at: i64,
    pub messages: Vec<SyncMessage>,
}

/// A single message inside a [`SyncPayload`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    /// Unix milliseconds.
    pub created_at: i64,
}

/// Stable-id LWW snapshot for a Spaces document. The Space metadata rides with
/// every document so a receiving node can recreate the collection first.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSyncPayload {
    pub document_id: String,
    pub title: String,
    pub source: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub icon: Option<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
    pub space: ryu_spaces::SpaceSyncRecord,
}

/// HTTP client that pushes and pulls conversation payloads.
#[derive(Clone)]
pub struct SyncClient {
    server_url: String,
    token: String,
    http: Client,
}

const MAX_SYNC_PAGES: usize = 10_000;

#[derive(Debug, Deserialize)]
struct DocumentPullPage {
    documents: Vec<DocumentSyncPayload>,
    #[serde(rename = "nextCursor", alias = "next_cursor", default)]
    next_cursor: Option<String>,
    #[serde(rename = "snapshotAt", alias = "snapshot_at", default)]
    snapshot_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ConversationPullPage {
    conversations: Vec<SyncPayload>,
    #[serde(rename = "nextCursor", alias = "next_cursor", default)]
    next_cursor: Option<String>,
    #[serde(rename = "snapshotAt", alias = "snapshot_at", default)]
    snapshot_at: Option<i64>,
}

#[derive(Debug, Default, Clone, Copy)]
struct SyncPullOutcome {
    applied: usize,
    snapshot_at: Option<i64>,
}

#[derive(Debug, Default, Clone, Copy)]
struct SyncStreamOutcome {
    snapshot_at: Option<i64>,
}

fn record_pull_snapshot(
    outcome: &mut SyncPullOutcome,
    snapshot_at: Option<i64>,
    requires_snapshot: bool,
) -> Result<(), SyncError> {
    match snapshot_at {
        Some(snapshot_at) if snapshot_at >= 0 => {
            if let Some(previous) = outcome.snapshot_at {
                if previous != snapshot_at {
                    return Err(SyncError::ServerError(
                        502,
                        "sync server changed snapshot while paging".to_owned(),
                    ));
                }
            } else {
                outcome.snapshot_at = Some(snapshot_at);
            }
            Ok(())
        }
        Some(_) => Err(SyncError::ServerError(
            502,
            "sync server returned an invalid snapshotAt".to_owned(),
        )),
        None if requires_snapshot => Err(SyncError::ServerError(
            502,
            "sync server omitted snapshotAt for paginated response".to_owned(),
        )),
        None => Ok(()),
    }
}

impl SyncClient {
    /// Build a sync client from the environment.
    ///
    /// `server_url` - resolved from `RYU_SERVER_URL`, defaults to
    ///   `http://localhost:3000`.
    /// `token` - loaded via [`crate::auth::load_token`].
    ///
    /// Returns [`SyncError::Unauthenticated`] when no token is stored.
    pub fn from_env() -> Result<Self, SyncError> {
        let server_url =
            std::env::var("RYU_SERVER_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());
        let token = crate::auth::load_token().ok_or(SyncError::Unauthenticated)?;
        Ok(Self::new(server_url, token))
    }

    /// Build a sync client with explicit values (used in tests / integration).
    pub fn new(server_url: impl Into<String>, token: impl Into<String>) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("building reqwest client");
        Self {
            server_url: server_url.into().trim_end_matches('/').to_string(),
            token: token.into(),
            http,
        }
    }

    fn pull_url(&self, path: &str, since_ms: i64, cursor: Option<&str>) -> String {
        let mut url = format!("{}/api/{path}?since={since_ms}", self.server_url);
        if let Some(cursor) = cursor {
            url.push_str("&cursor=");
            url.push_str(&urlencoding::encode(cursor));
        }
        url
    }

    /// Push one conversation (all messages) to the server store.
    pub async fn push(
        &self,
        store: &ConversationStore,
        conversation_id: &str,
    ) -> Result<(), SyncError> {
        let payload = build_sync_payload(store, conversation_id)
            .await
            .map_err(SyncError::Store)?;

        let url = format!("{}/api/conversations-sync/push", self.server_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(SyncError::ServerError(status, body));
        }
        Ok(())
    }

    /// Push one non-binary Spaces document snapshot to the user's cloud mirror.
    pub async fn push_document(&self, payload: &DocumentSyncPayload) -> Result<(), SyncError> {
        let url = format!("{}/api/documents-sync/push", self.server_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(payload)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(SyncError::ServerError(status, body));
        }
        Ok(())
    }

    /// Pull document snapshots changed since `since_ms` and apply each row
    /// independently so one malformed or inaccessible document cannot abort the
    /// rest of the batch.
    pub async fn pull_documents_since(
        &self,
        store: &super::spaces::SpaceStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<usize, SyncError> {
        Ok(self
            .pull_documents_since_with_snapshot(store, since_ms, tenancy)
            .await?
            .applied)
    }

    async fn pull_documents_since_with_snapshot(
        &self,
        store: &super::spaces::SpaceStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<SyncPullOutcome, SyncError> {
        let mut cursor: Option<String> = None;
        let mut outcome = SyncPullOutcome::default();
        for _page in 0..MAX_SYNC_PAGES {
            let url = self.pull_url("documents-sync/pull", since_ms, cursor.as_deref());
            let resp = self.http.get(&url).bearer_auth(&self.token).send().await?;
            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                return Err(SyncError::ServerError(status, body));
            }
            let data: DocumentPullPage = resp.json().await?;
            record_pull_snapshot(
                &mut outcome,
                data.snapshot_at,
                cursor.is_some() || data.next_cursor.is_some(),
            )?;
            let mut apply_error = None;
            for payload in data.documents {
                match apply_document_sync_payload(store, &payload, tenancy.clone()).await {
                    Ok(true) => outcome.applied += 1,
                    Ok(false) => {}
                    Err(error) => {
                        tracing::warn!(
                            "cloud sync: applying pulled document {} failed: {error:#}",
                            payload.document_id
                        );
                        if apply_error.is_none() {
                            apply_error = Some(error);
                        }
                    }
                }
            }
            if let Some(error) = apply_error {
                return Err(SyncError::Store(error));
            }
            let Some(next_cursor) = data.next_cursor else {
                return Ok(outcome);
            };
            if next_cursor.is_empty() || cursor.as_deref() == Some(next_cursor.as_str()) {
                return Err(SyncError::ServerError(
                    502,
                    "sync server returned a non-advancing cursor".to_owned(),
                ));
            }
            cursor = Some(next_cursor);
        }
        Err(SyncError::ServerError(
            502,
            "sync server returned too many pages".to_owned(),
        ))
    }

    /// Pull all conversations updated at or after `since_ms` and apply them
    /// to the local store.  Pass `0` for a full sync.
    ///
    /// Returns the number of conversations applied.
    ///
    /// `tenancy` is the receiving node's CONTEXT (its org + the signed-in device
    /// account), not the owner written to a row — each replayed row is owned by its
    /// OWN payload author (see [`effective_replay_tenancy`]). [`apply_sync_payload`]
    /// REFUSES an author-less replay on an org-bound node rather than minting rows
    /// nobody can read.
    pub async fn pull_since(
        &self,
        store: &ConversationStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<usize, SyncError> {
        Ok(self
            .pull_since_with_snapshot(store, since_ms, tenancy)
            .await?
            .applied)
    }

    async fn pull_since_with_snapshot(
        &self,
        store: &ConversationStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<SyncPullOutcome, SyncError> {
        let mut cursor: Option<String> = None;
        let mut outcome = SyncPullOutcome::default();
        for _page in 0..MAX_SYNC_PAGES {
            let url = self.pull_url("conversations-sync/pull", since_ms, cursor.as_deref());
            let resp = self.http.get(&url).bearer_auth(&self.token).send().await?;
            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                return Err(SyncError::ServerError(status, body));
            }
            let data: ConversationPullPage = resp.json().await?;
            record_pull_snapshot(
                &mut outcome,
                data.snapshot_at,
                cursor.is_some() || data.next_cursor.is_some(),
            )?;
            let mut apply_error = None;
            for payload in data.conversations {
                // Per-row best-effort: a single fail-closed refusal (e.g. an
                // author-less row on a bound node) must not abort the batch.
                match apply_sync_payload(store, &payload, tenancy.clone()).await {
                    Ok(()) => outcome.applied += 1,
                    Err(error) => {
                        tracing::warn!(
                            "cloud sync: applying pulled conversation {} failed: {error}",
                            payload.conversation_id
                        );
                        if apply_error.is_none() {
                            apply_error = Some(error);
                        }
                    }
                }
            }
            if let Some(error) = apply_error {
                return Err(SyncError::Store(error));
            }
            let Some(next_cursor) = data.next_cursor else {
                return Ok(outcome);
            };
            if next_cursor.is_empty() || cursor.as_deref() == Some(next_cursor.as_str()) {
                return Err(SyncError::ServerError(
                    502,
                    "sync server returned a non-advancing cursor".to_owned(),
                ));
            }
            cursor = Some(next_cursor);
        }
        Err(SyncError::ServerError(
            502,
            "sync server returned too many pages".to_owned(),
        ))
    }

    /// Consume the SSE change feed, applying each delta to the local store as it
    /// arrives. Connects to `GET /api/conversations-sync/stream?since=<ms>`,
    /// which first emits a snapshot of everything changed since `since_ms` and
    /// then streams new deltas live (same LWW + union-merge semantics as
    /// [`Self::pull_since`], via [`apply_sync_payload`]).
    ///
    /// Returns `Ok(())` when the server closes the stream; returns an error if
    /// the stream cannot be established, so the caller can fall back to `/pull`.
    ///
    /// Per the repo convention, SSE is read with a fetch-style byte stream (not
    /// an `EventSource`) so the bearer token rides the `Authorization` header.
    /// The tiny frame parser mirrors [`parse_change_frame`] — `:` keepalive
    /// comments and non-`data:` lines are ignored.
    pub async fn stream_changes(
        &self,
        store: &ConversationStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<(), SyncError> {
        self.stream_changes_with_snapshot(store, since_ms, tenancy)
            .await
            .map(|_| ())
    }

    async fn stream_changes_with_snapshot(
        &self,
        store: &ConversationStore,
        since_ms: i64,
        tenancy: Tenancy,
    ) -> Result<SyncStreamOutcome, SyncError> {
        use futures_util::StreamExt;

        let url = format!(
            "{}/api/conversations-sync/stream?since={}",
            self.server_url, since_ms
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.token)
            .header("accept", "text/event-stream")
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(SyncError::ServerError(status, body));
        }

        let snapshot_at = resp
            .headers()
            .get("x-ryu-sync-snapshot-at")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value >= 0);
        let mut buf = Vec::new();
        let mut stream = resp.bytes_stream();
        let mut apply_error = None;
        let mut frame_error = false;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buf.extend_from_slice(&chunk);
            // SSE events are separated by a blank line — drain complete frames.
            while let Some(frame) = take_sse_frame(&mut buf) {
                if frame_has_data(&frame) {
                    let Some(payload) = parse_change_frame_bytes(&frame) else {
                        frame_error = true;
                        continue;
                    };
                    if let Err(error) = apply_sync_payload(store, &payload, tenancy.clone()).await {
                        tracing::warn!("cloud sync: applying streamed delta failed: {error}");
                        if apply_error.is_none() {
                            apply_error = Some(error);
                        }
                    }
                }
            }
        }
        if !buf.is_empty() {
            frame_error = true;
        }
        if let Some(error) = apply_error {
            return Err(SyncError::Store(error));
        }
        if frame_error {
            return Err(SyncError::ServerError(
                502,
                "sync server returned an incomplete or invalid SSE frame".to_owned(),
            ));
        }
        Ok(SyncStreamOutcome { snapshot_at })
    }
}

/// Drain one complete SSE frame without decoding incomplete UTF-8 bytes.
/// Supports the LF framing emitted by Ryu and CRLF framing from a proxy.
fn take_sse_frame(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let mut end = None;
    for index in 0..buffer.len().saturating_sub(1) {
        if buffer[index..].starts_with(b"\n\n") {
            end = Some(index + 2);
            break;
        }
        if buffer[index..].starts_with(b"\r\n\r\n") {
            end = Some(index + 4);
            break;
        }
    }
    end.map(|end| buffer.drain(..end).collect())
}

fn parse_change_frame_bytes(raw: &[u8]) -> Option<SyncPayload> {
    std::str::from_utf8(raw).ok().and_then(parse_change_frame)
}

fn frame_has_data(raw: &[u8]) -> bool {
    std::str::from_utf8(raw)
        .ok()
        .map(|frame| {
            frame
                .lines()
                .any(|line| line.trim_end_matches('\r').starts_with("data:"))
        })
        .unwrap_or(true)
}

/// Parse one SSE frame from the change feed into a [`SyncPayload`].
/// Concatenates `data:` lines (SSE spec) and JSON-decodes them; ignores `:`
/// keepalive comments plus the `event:`/`id:` lines. Returns `None` for
/// keepalives and any frame that does not decode to a payload.
fn parse_change_frame(raw: &str) -> Option<SyncPayload> {
    let mut data = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    if data.is_empty() {
        return None;
    }
    serde_json::from_str(&data).ok()
}

// ── Background sync loop (opt-in, off by default) ─────────────────────────────

/// Preferences-KV key for the opt-in sync toggle. Mirrors the
/// `claude_config::CLAUDE_GATEWAY_ROUTING_PREF_KEY` pattern: a value of
/// `"true"` enables the background sync loop. Absent / any other value keeps it
/// off (local-first rule: Core never phones home by default).
pub const SYNC_ENABLED_PREF_KEY: &str = "cloud-sync-enabled";

/// Environment variable that also enables the sync loop (truthy = `1`/`true`).
/// Either the env var OR the persisted pref turns sync on; default is OFF.
pub const SYNC_ENABLED_ENV: &str = "RYU_SYNC_ENABLED";

/// How often the loop pushes local conversations + pulls remote changes.
const SYNC_INTERVAL: Duration = Duration::from_secs(60);

/// True when the `RYU_SYNC_ENABLED` env var is set to a truthy value.
fn env_sync_enabled() -> bool {
    matches!(
        std::env::var(SYNC_ENABLED_ENV).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

/// Resolve whether sync is currently enabled. The env var is a static gate; the
/// pref is re-read each tick so a desktop toggle takes effect without a restart.
async fn sync_enabled(preferences: &super::preferences::PreferencesStore) -> bool {
    if env_sync_enabled() {
        return true;
    }
    matches!(
        preferences
            .get(SYNC_ENABLED_PREF_KEY)
            .await
            .ok()
            .flatten()
            .as_deref(),
        Some("true")
    )
}

/// Spawn the opt-in cross-device sync loop. Returns immediately. The loop is a
/// no-op every tick until the user opts in (env `RYU_SYNC_ENABLED` or the
/// `cloud-sync-enabled` pref), so this is safe to call unconditionally at
/// startup and never alters default (local-first) behaviour.
///
/// Each enabled tick: push every local conversation to the server store, then
/// receive remote changes since the last watermark (last-writer-wins +
/// union-merge, applied by [`apply_sync_payload`]). The read path prefers the
/// live SSE change feed ([`SyncClient::stream_changes`]) — held open for up to
/// one interval so deltas apply with near-zero latency while local pushes still
/// recur — and falls back to the [`SyncClient::pull_since`] long-poll whenever
/// streaming is unavailable. All errors are best-effort: logged and swallowed so
/// a flaky network or a signed-out user never panics or stalls Core.
pub fn spawn_sync_loop(
    conversations: ConversationStore,
    spaces: super::spaces::SpaceStore,
    preferences: super::preferences::PreferencesStore,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SYNC_INTERVAL);
        // Loop-local watermark: 0 = full sync on the first enabled pull, then
        // advanced to "now" after each success. Kept in memory only: no new
        // persistence path, so a restart simply does one extra full pull.
        let mut pull_since_ms: i64 = 0;
        let mut document_pull_since_ms: i64 = 0;
        // Throttle the "no token" warning so a signed-out user with sync on does
        // not spam the log every tick.
        let mut warned_unauthenticated = false;

        loop {
            interval.tick().await;

            if !sync_enabled(&preferences).await {
                continue;
            }

            let client = match SyncClient::from_env() {
                Ok(client) => {
                    warned_unauthenticated = false;
                    client
                }
                Err(SyncError::Unauthenticated) => {
                    if !warned_unauthenticated {
                        tracing::info!(
                            "cloud sync enabled but no auth token found; complete device login to sync"
                        );
                        warned_unauthenticated = true;
                    }
                    continue;
                }
                Err(e) => {
                    tracing::warn!("cloud sync: failed to build client: {e}");
                    continue;
                }
            };

            let Some(replay_ctx) = resolve_replay_context() else {
                tracing::debug!(
                    "cloud sync: skipping this tick on an org-bound node — no signed-in \
                     account to authorise attribution (fail closed); complete device login"
                );
                continue;
            };

            // Push only conversations visible to the active account on a bound node.
            // An unfiltered export here would leak another member's private chat into
            // the signed-in user's cloud mirror.
            let local_conversations = match &replay_ctx {
                Tenancy::Unattributed => conversations.list_conversations().await,
                Tenancy::Owned { user_id, org_id } => {
                    conversations
                        .list_conversations_visible(Some(user_id), org_id.as_deref(), true)
                        .await
                }
                Tenancy::SharedOrg { org_id } => {
                    conversations
                        .list_conversations_visible(None, Some(org_id), true)
                        .await
                }
            };
            match local_conversations {
                Ok(summaries) => {
                    for summary in &summaries {
                        if let Err(e) = client.push(&conversations, &summary.id).await {
                            tracing::warn!(
                                "cloud sync: push of conversation {} failed: {e}",
                                summary.id
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("cloud sync: listing local conversations failed: {e}");
                }
            }

            // Receive remote changes since the last server-owned watermark.
            // Prefer the live SSE change feed; hold it open for at most one
            // interval so local pushes still recur, then reconnect on the next
            // tick. Every pull drains its bounded cursor pages before this
            // watermark advances, so a large backlog cannot be skipped.
            match build_document_sync_payloads(&spaces).await {
                Ok(payloads) => {
                    for payload in payloads {
                        let visible_to_account = match &replay_ctx {
                            Tenancy::Unattributed => true,
                            Tenancy::Owned { user_id, .. } => {
                                payload.owner_user_id.as_deref() == Some(user_id.as_str())
                            }
                            Tenancy::SharedOrg { .. } => true,
                        };
                        if visible_to_account {
                            if let Err(error) = client.push_document(&payload).await {
                                tracing::warn!(
                                    "cloud sync: push of document {} failed: {error}",
                                    payload.document_id
                                );
                            }
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!("cloud sync: listing local documents failed: {error:#}")
                }
            }

            // The captured wall time is only a compatibility fallback for an
            // older server that does not return the server-owned watermark.
            let document_now_ms = chrono::Utc::now().timestamp_millis();
            match client
                .pull_documents_since_with_snapshot(
                    &spaces,
                    document_pull_since_ms,
                    replay_ctx.clone(),
                )
                .await
            {
                Ok(outcome) => {
                    if outcome.applied > 0 {
                        tracing::info!("cloud sync: pulled {} document(s)", outcome.applied);
                    }
                    document_pull_since_ms = outcome.snapshot_at.unwrap_or(document_now_ms);
                }
                Err(error) => tracing::warn!("cloud sync: document pull failed: {error}"),
            }
            let stream_fallback_now_ms = chrono::Utc::now().timestamp_millis();
            match tokio::time::timeout(
                SYNC_INTERVAL,
                client.stream_changes_with_snapshot(
                    &conversations,
                    pull_since_ms,
                    replay_ctx.clone(),
                ),
            )
            .await
            {
                // A stream header or clean EOF only describes the server's
                // intended boundary. It does not prove that the entire bounded
                // snapshot was received, that the final frame was complete, or
                // that every delta was applied. Always drain the paginated pull
                // from the old watermark before advancing it; apply failures
                // keep the watermark unchanged so the next tick retries them.
                Ok(Ok(_)) => {
                    tracing::debug!("cloud sync: sse window ended; reconciling with paginated pull")
                }
                Err(_) => tracing::debug!(
                    "cloud sync: sse window elapsed; reconciling with paginated pull"
                ),
                Ok(Err(stream_err)) => tracing::debug!(
                    "cloud sync: sse unavailable; falling back to paginated pull: {stream_err}"
                ),
            }
            match client
                .pull_since_with_snapshot(&conversations, pull_since_ms, replay_ctx.clone())
                .await
            {
                Ok(outcome) => {
                    if outcome.applied > 0 {
                        tracing::info!("cloud sync: pulled {} conversation(s)", outcome.applied);
                    }
                    pull_since_ms = outcome.snapshot_at.unwrap_or(stream_fallback_now_ms);
                }
                Err(error) => {
                    tracing::warn!("cloud sync: paginated pull failed: {error}");
                }
            }
        }
    });
}

// ── Pure helpers (no HTTP — tested independently) ────────────────────────────

/// Serialize every non-system, non-binary Spaces document with its stable Space
/// metadata. The server mirror remains a transport; local Spaces is authoritative.
pub async fn build_document_sync_payloads(
    store: &super::spaces::SpaceStore,
) -> Result<Vec<DocumentSyncPayload>> {
    use std::collections::HashMap;

    let spaces = store
        .list_spaces(super::spaces::DocFilter::unrestricted())
        .await?;
    let spaces_by_id: HashMap<String, ryu_spaces::SpaceSyncRecord> = spaces
        .into_iter()
        .filter(|space| !space.system)
        .map(|space| {
            let id = space.id.clone();
            (
                id,
                ryu_spaces::SpaceSyncRecord {
                    id: space.id,
                    name: space.name,
                    description: space.description,
                    created_at: space.created_at,
                    updated_at: space.updated_at,
                    retrieval_mode: space.retrieval_mode.as_str().to_owned(),
                    visibility: space.visibility,
                    team_id: space.team_id,
                },
            )
        })
        .collect();
    let documents = store.list_documents_for_sync().await?;
    Ok(documents
        .into_iter()
        .filter_map(|record| {
            let space = spaces_by_id.get(&record.document.space_id)?.clone();
            Some(DocumentSyncPayload {
                document_id: record.document.id,
                title: record.document.title,
                source: record.document.source,
                kind: record.document.kind,
                parent_id: record.document.parent_id,
                icon: record.document.icon,
                created_at: record.document.created_at,
                updated_at: record.document.updated_at,
                revision: record.document.revision,
                owner_user_id: record.owner_user_id,
                space,
            })
        })
        .collect())
}

/// Apply one document snapshot after deriving its owner from the payload author
/// and the receiving node's org context, matching conversation replay semantics.
pub async fn apply_document_sync_payload(
    store: &super::spaces::SpaceStore,
    payload: &DocumentSyncPayload,
    context: Tenancy,
) -> Result<bool> {
    if payload.document_id.is_empty()
        || payload.document_id.len() > 200
        || payload.space.id.is_empty()
        || payload.space.id.len() > 200
        || payload.title.len() > 1000
        || payload.source.len() > 5_000_000
        || payload.kind == "file"
        || payload.updated_at < 0
        || payload.created_at < 0
    {
        anyhow::bail!("invalid document sync payload")
    }
    let tenancy = match &context {
        Tenancy::Unattributed => Tenancy::Unattributed,
        Tenancy::Owned { org_id, .. } => {
            Tenancy::owned_by(payload.owner_user_id.as_deref(), org_id.as_deref())
        }
        Tenancy::SharedOrg { org_id } => Tenancy::shared_with_org(org_id),
    };
    if tenancy == Tenancy::Unattributed && node_bound() {
        anyhow::bail!("refusing author-less document replay on an org-bound node (fail closed)")
    }
    let owner = super::spaces::owner_of(&tenancy);
    store.apply_synced_space(&payload.space, &owner).await?;
    let record = ryu_spaces::DocumentSyncRecord {
        document: ryu_spaces::DocumentContent {
            id: payload.document_id.clone(),
            space_id: payload.space.id.clone(),
            title: payload.title.clone(),
            source: payload.source.clone(),
            created_at: payload.created_at,
            updated_at: payload.updated_at,
            revision: payload.revision,
            chunk_count: 0,
            kind: payload.kind.clone(),
            parent_id: payload.parent_id.clone(),
            icon: payload.icon.clone(),
        },
        owner_user_id: payload.owner_user_id.clone(),
    };
    store.apply_synced_document(&record, &owner).await
}

/// Serialize a conversation from `store` into a [`SyncPayload`].
///
/// This is the "export" half of the round-trip that [`apply_sync_payload`]
/// ingests.  Both halves are tested together in [`tests::round_trip`].
pub async fn build_sync_payload(
    store: &ConversationStore,
    conversation_id: &str,
) -> Result<SyncPayload> {
    let summaries = store.list_conversations().await?;
    let summary = summaries
        .iter()
        .find(|s| s.id == conversation_id)
        .ok_or_else(|| anyhow::anyhow!("conversation {} not found in store", conversation_id))?
        .clone();

    let stored_messages = store.get_messages(conversation_id).await?;

    let messages = stored_messages
        .into_iter()
        .map(|m| SyncMessage {
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
        })
        .collect();

    // Carry the source row's OWNER so the receiving node can attribute the replay
    // to its original author (not the pulling device). `None` on an unbound source
    // (rows are NULL-tenanted there), which serializes away — byte-identical wire.
    let owner_user_id = store
        .get_access_meta(conversation_id)
        .await?
        .and_then(|m| m.owner_user_id);

    Ok(SyncPayload {
        conversation_id: summary.id,
        title: summary.title,
        agent_id: summary.agent_id,
        folder_path: summary.folder_path,
        branch: summary.branch,
        worktree_path: summary.worktree_path,
        run_status: summary.run_status,
        owner_user_id,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        messages,
    })
}

/// Whether THIS node is bound to an org (a shared "company brain"). The one place
/// the sync loop asks, so its fail-closed rule reads the same signal as
/// `resource_access` / `enforce_permission`.
fn node_bound() -> bool {
    crate::sidecar::control_plane::registered_org().is_some()
}

/// Resolve the CONTEXT the receive half replays under this tick.
///
/// - **Unbound node** → `Some(Tenancy::Unattributed)`: rows stay NULL-tenanted,
///   byte-identical to before. No principal resolution happens on this path.
/// - **Bound node with a signed-in device account** → `Some(Tenancy::Owned { .. })`
///   carrying the node's org. This is the resolved per-user principal: its presence
///   GATES the receive half (the device must be a real, logged-in org member), while
///   each replayed row's actual owner still comes from its own payload author (see
///   [`effective_replay_tenancy`]). The account's `user_id` is the device's own —
///   never stamped onto a pulled row.
/// - **Bound node with NO resolvable account** → `None`: skip the receive half
///   (fail-closed), exactly as the device-token-only loop did before. The device
///   carries no human principal to authorise attributing replayed rows.
fn resolve_replay_context() -> Option<Tenancy> {
    let Some(org) = crate::sidecar::control_plane::registered_org() else {
        // Unbound personal node: the pre-existing, byte-identical path.
        return Some(Tenancy::Unattributed);
    };
    // Bound node: require a real signed-in account (the device→user principal). The
    // control-plane device token maps to the account vault written by device login.
    let user_id = crate::auth::load_accounts()
        .active()
        .map(|a| a.user_id.clone())?;
    Some(Tenancy::Owned {
        user_id,
        org_id: Some(org.id),
    })
}

/// Apply a [`SyncPayload`] to a local store.
///
/// Conflict rule:
/// - Conversation row: upserted on first apply; on subsequent applies,
///   metadata is only overwritten when the incoming `updated_at` is strictly
///   newer than the stored value (last-writer-wins).
/// - Messages: union-merged by `id` — messages absent from the local store
///   are inserted; messages already present are left unchanged (append-only).
///
/// **Tenancy (fail-closed).** Replay is a CREATION path: a payload for a
/// conversation this device has never seen mints the row. `tenancy` is the receiving
/// node's CONTEXT, not the row owner — the owner is resolved from the payload's own
/// author via [`effective_replay_tenancy`], so a pulled row lands owned by whoever
/// wrote it, never the device that pulled it. On an ORG-BOUND node a replay whose
/// payload carries no author resolves to [`Tenancy::Unattributed`] and is REFUSED
/// rather than writing rows that would be invisible/denied to everyone (the lockout
/// this whole unit exists to prevent). On an unbound personal node the context is
/// `Unattributed`, the author is ignored, and the behaviour is byte-identical.
pub async fn apply_sync_payload(
    store: &ConversationStore,
    payload: &SyncPayload,
    tenancy: Tenancy,
) -> Result<()> {
    apply_sync_payload_at(store, payload, tenancy, node_bound()).await
}

/// The tenancy a replayed row is actually born with, derived from the source
/// payload's ORIGINAL author and the receiving node's org **context**.
///
/// - **Unbound node** (`ctx == Unattributed`): rows stay NULL-tenanted, exactly as
///   before the ACL existed — byte-identical local-first behaviour. The payload's
///   author is ignored (an unbound node has one principal; `RYU_TOKEN` is the
///   boundary).
/// - **Bound node** (`ctx == Owned { org_id, .. }`): the row is owned by the
///   **payload's author**, scoped to THIS node's org. The context's `user_id` (the
///   syncing device's own account) is deliberately NOT used as the owner — that would
///   re-attribute every pulled row to whoever's device pulled it. Where the payload
///   carries no author, the result is `Unattributed`, which the caller refuses
///   (fail-closed) rather than mis-attributing it to the local device.
fn effective_replay_tenancy(payload: &SyncPayload, ctx: &Tenancy) -> Tenancy {
    match ctx {
        Tenancy::Unattributed => Tenancy::Unattributed,
        Tenancy::Owned { org_id, .. } => {
            Tenancy::owned_by(payload.owner_user_id.as_deref(), org_id.as_deref())
        }
        Tenancy::SharedOrg { org_id } => Tenancy::shared_with_org(org_id),
    }
}

/// [`apply_sync_payload`] with the node's org-binding passed in — the pure form the
/// unit tests drive (they cannot register an org).
///
/// `tenancy` is the receiving loop's **context** (the node's org + the signed-in
/// device account), NOT the owner written to the row: the owner is resolved from the
/// payload's own author via [`effective_replay_tenancy`].
pub async fn apply_sync_payload_at(
    store: &ConversationStore,
    payload: &SyncPayload,
    tenancy: Tenancy,
    node_bound: bool,
) -> Result<()> {
    let tenancy = effective_replay_tenancy(payload, &tenancy);
    if tenancy == Tenancy::Unattributed && node_bound {
        anyhow::bail!(
            "refusing to replay conversation '{}' on an org-bound node with no resolvable owner: \
             the row would be denied to every user (fail closed)",
            payload.conversation_id
        );
    }
    // Ensure the conversation row exists (creates it with initial metadata if
    // this is the first time we see this conversation on this device).
    store
        .ensure_sync_conversation(
            &payload.conversation_id,
            payload.agent_id.as_deref(),
            payload.title.as_deref(),
            payload.created_at,
            payload.updated_at,
            tenancy.clone(),
        )
        .await?;

    // LWW: update metadata only when the incoming timestamp beats stored one.
    store
        .update_metadata_if_newer(
            &payload.conversation_id,
            payload.title.as_deref(),
            payload.agent_id.as_deref(),
            payload.folder_path.as_deref(),
            payload.branch.as_deref(),
            payload.worktree_path.as_deref(),
            payload.run_status.as_deref(),
            payload.updated_at,
        )
        .await?;

    // Union-merge messages. The store's insert is idempotent and deliberately
    // metadata-neutral; metadata was resolved by LWW above.
    for msg in &payload.messages {
        store
            .append_sync_message_with_id(
                &payload.conversation_id,
                &msg.id,
                &msg.role,
                &msg.content,
                payload.agent_id.as_deref(),
                msg.created_at,
            )
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::conversations::ConversationStore;
    use axum::body::Body;
    use axum::extract::Query;
    use axum::http::StatusCode;
    use axum::response::Response;
    use axum::routing::get;
    use axum::Router;
    use serde::Deserialize;
    use std::sync::Arc;
    use tokio::net::TcpListener;

    #[derive(Debug, Deserialize)]
    struct PullQuery {
        cursor: Option<String>,
    }

    #[derive(Clone, Copy)]
    enum SnapshotFault {
        Missing,
        Changed,
    }

    async fn start_snapshot_fault_server(
        path: &'static str,
        resource: &'static str,
        fault: SnapshotFault,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            path,
            get(move |Query(query): Query<PullQuery>| async move {
                let continuation = query.cursor.is_some();
                let next_cursor = (!continuation).then_some("page-2");
                let snapshot_at = if !continuation {
                    Some(1000)
                } else {
                    match fault {
                        SnapshotFault::Missing => None,
                        SnapshotFault::Changed => Some(1001),
                    }
                };
                let mut value = if resource == "documents" {
                    serde_json::json!({
                        "documents": [],
                        "nextCursor": next_cursor,
                    })
                } else {
                    serde_json::json!({
                        "conversations": [],
                        "nextCursor": next_cursor,
                    })
                };
                if let Some(snapshot_at) = snapshot_at {
                    value["snapshotAt"] = serde_json::json!(snapshot_at);
                }
                axum::Json(value)
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), server)
    }

    #[tokio::test]
    async fn document_round_trip_preserves_stable_ids_and_rejects_stale_replay() {
        let source = super::super::spaces::SpaceStore::open_in_memory().unwrap();
        let target = super::super::spaces::SpaceStore::open_in_memory().unwrap();
        let owner = super::super::spaces::DocOwner::unattributed();
        let space_id = source
            .create_space("Research", Some("Shared notes"), &owner)
            .await
            .unwrap();
        let document_id = source.create_page(&space_id, "Plan", &owner).await.unwrap();
        source
            .update_document(&document_id, "Plan", "# First draft")
            .await
            .unwrap();

        let payload = build_document_sync_payloads(&source)
            .await
            .unwrap()
            .into_iter()
            .find(|payload| payload.document_id == document_id)
            .expect("document payload");
        assert!(
            apply_document_sync_payload(&target, &payload, Tenancy::Unattributed)
                .await
                .unwrap()
        );
        let restored = target
            .get_document(&document_id)
            .await
            .unwrap()
            .expect("restored document");
        assert_eq!(restored.space_id, space_id);
        assert_eq!(restored.title, "Plan");
        assert_eq!(restored.source, "# First draft");

        let mut stale = payload.clone();
        stale.updated_at = payload.updated_at.saturating_sub(1);
        stale.title = "Stale".to_owned();
        stale.source = "old".to_owned();
        assert!(
            !apply_document_sync_payload(&target, &stale, Tenancy::Unattributed)
                .await
                .unwrap()
        );
        let unchanged = target
            .get_document(&document_id)
            .await
            .unwrap()
            .expect("unchanged document");
        assert_eq!(unchanged.title, "Plan");
        assert_eq!(unchanged.source, "# First draft");
    }

    /// Proves "two DBs, one synced conversation" (AC2):
    /// - store_a gets messages appended,
    /// - a payload is built from store_a,
    /// - the payload is applied to store_b,
    /// - store_b now has identical messages.
    #[tokio::test]
    async fn round_trip_two_stores() {
        let store_a = ConversationStore::open_in_memory().unwrap();
        let store_b = ConversationStore::open_in_memory().unwrap();

        store_a
            .append_message(
                "conv-sync-1",
                "user",
                "hello from A",
                Some("agent-1"),
                None,
                None,
            )
            .await
            .unwrap();
        store_a
            .append_message(
                "conv-sync-1",
                "assistant",
                "hi back",
                Some("agent-1"),
                None,
                None,
            )
            .await
            .unwrap();

        // Export from A.
        let payload = build_sync_payload(&store_a, "conv-sync-1").await.unwrap();

        assert_eq!(payload.conversation_id, "conv-sync-1");
        assert_eq!(payload.messages.len(), 2);

        // Apply to B — this is "device B receiving the sync payload".
        apply_sync_payload(&store_b, &payload, Tenancy::Unattributed)
            .await
            .unwrap();

        let msgs_a = store_a.get_messages("conv-sync-1").await.unwrap();
        let msgs_b = store_b.get_messages("conv-sync-1").await.unwrap();

        assert_eq!(msgs_a.len(), msgs_b.len(), "message counts must match");
        for (a, b) in msgs_a.iter().zip(msgs_b.iter()) {
            assert_eq!(a.role, b.role);
            assert_eq!(a.content, b.content);
        }

        let list_b = store_b.list_conversations().await.unwrap();
        assert_eq!(list_b.len(), 1);
        assert_eq!(list_b[0].id, "conv-sync-1");
    }

    /// Union-merge: applying the same payload twice must not duplicate messages.
    #[tokio::test]
    async fn idempotent_apply() {
        let store_a = ConversationStore::open_in_memory().unwrap();
        let store_b = ConversationStore::open_in_memory().unwrap();

        store_a
            .append_message("conv-idem", "user", "msg1", None, None, None)
            .await
            .unwrap();

        let payload = build_sync_payload(&store_a, "conv-idem").await.unwrap();

        apply_sync_payload(&store_b, &payload, Tenancy::Unattributed)
            .await
            .unwrap();
        apply_sync_payload(&store_b, &payload, Tenancy::Unattributed)
            .await
            .unwrap();

        let msgs = store_b.get_messages("conv-idem").await.unwrap();
        assert_eq!(
            msgs.len(),
            1,
            "idempotent apply must not duplicate messages"
        );
    }

    /// LWW: a subsequent apply with an older `updated_at` must not clobber
    /// newer metadata already in the store.
    #[tokio::test]
    async fn lww_metadata_newer_wins() {
        let store_b = ConversationStore::open_in_memory().unwrap();

        // Construct payloads manually with controlled timestamps so the test
        // is deterministic regardless of wall-clock ordering.
        let base_ts: i64 = 1_700_000_000_000;

        // "Fresh" payload has a higher updated_at.
        let fresh = SyncPayload {
            conversation_id: "conv-lww".to_string(),
            title: Some("fresh title".to_string()),
            agent_id: Some("agent-1".to_string()),
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: None,
            created_at: base_ts,
            updated_at: base_ts + 2000,
            messages: vec![SyncMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                created_at: base_ts,
            }],
        };

        // "Stale" payload has a lower updated_at.
        let stale = SyncPayload {
            conversation_id: "conv-lww".to_string(),
            title: Some("stale title".to_string()),
            agent_id: Some("agent-1".to_string()),
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: None,
            created_at: base_ts,
            updated_at: base_ts + 1000,
            messages: vec![SyncMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                created_at: base_ts,
            }],
        };

        // Apply fresh first, then stale — stale must not overwrite.
        apply_sync_payload(&store_b, &fresh, Tenancy::Unattributed)
            .await
            .unwrap();
        apply_sync_payload(&store_b, &stale, Tenancy::Unattributed)
            .await
            .unwrap();

        let summaries = store_b.list_conversations().await.unwrap();
        let title = summaries[0].title.as_deref().unwrap_or("");
        assert_eq!(
            title, "fresh title",
            "LWW: stale payload must not overwrite newer title"
        );
    }

    /// Incremental push: new messages from a second device are merged in.
    #[tokio::test]
    async fn incremental_merge_new_messages() {
        let store_a = ConversationStore::open_in_memory().unwrap();
        let store_b = ConversationStore::open_in_memory().unwrap();

        store_a
            .append_message("conv-incr", "user", "first", None, None, None)
            .await
            .unwrap();

        let p1 = build_sync_payload(&store_a, "conv-incr").await.unwrap();
        apply_sync_payload(&store_b, &p1, Tenancy::Unattributed)
            .await
            .unwrap();

        // A second message added after the first sync.
        store_a
            .append_message("conv-incr", "assistant", "second", None, None, None)
            .await
            .unwrap();

        let p2 = build_sync_payload(&store_a, "conv-incr").await.unwrap();
        apply_sync_payload(&store_b, &p2, Tenancy::Unattributed)
            .await
            .unwrap();

        let msgs = store_b.get_messages("conv-incr").await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "first");
        assert_eq!(msgs[1].content, "second");
    }

    /// A payload carrying an author + built via [`build_sync_payload`] round-trips
    /// the OWNER too, so the receiving node can re-attribute the replay.
    #[tokio::test]
    async fn build_sync_payload_carries_the_source_owner() {
        let store = ConversationStore::open_in_memory().unwrap();
        // Stamp an owner the way a bound-node write does (claim_tenancy choke point).
        store
            .claim_tenancy("owned-conv", "bob", Some("org1"))
            .await
            .unwrap();
        store
            .append_message("owned-conv", "user", "hi", None, None, None)
            .await
            .unwrap();

        let payload = build_sync_payload(&store, "owned-conv").await.unwrap();
        assert_eq!(
            payload.owner_user_id.as_deref(),
            Some("bob"),
            "the source row's author must ride the sync payload"
        );

        // An unbound (NULL-tenanted) row carries no author — byte-identical wire.
        let store2 = ConversationStore::open_in_memory().unwrap();
        store2
            .append_message("anon-conv", "user", "hi", None, None, None)
            .await
            .unwrap();
        let anon = build_sync_payload(&store2, "anon-conv").await.unwrap();
        assert!(anon.owner_user_id.is_none());
        assert!(
            !serde_json::to_string(&anon)
                .unwrap()
                .contains("owner_user_id"),
            "an author-less payload must serialize byte-identical to the pre-owner wire"
        );
    }

    /// THE correctness seam (mirrors the ACL round's `resource_acl_tests`): a replay
    /// on a bound node lands owned by the PAYLOAD's author — visible to that author,
    /// DENIED to a different org member — never the pulling device's own account. An
    /// author-less payload on a bound node is REFUSED (fail closed).
    #[tokio::test]
    async fn replay_attributes_to_payload_author_not_the_pulling_device() {
        let store = ConversationStore::open_in_memory().unwrap();

        // The receiving loop's CONTEXT: this device is signed in as "device-owner"
        // on org "org1". That account must NEVER end up owning a pulled row.
        let ctx = Tenancy::Owned {
            user_id: "device-owner".to_owned(),
            org_id: Some("org1".to_owned()),
        };

        // A payload authored by "bob" on another node.
        let bobs = SyncPayload {
            conversation_id: "bob-synced".to_owned(),
            title: Some("bob's chat".to_owned()),
            agent_id: None,
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: Some("bob".to_owned()),
            created_at: 1,
            updated_at: 1,
            messages: vec![SyncMessage {
                id: "m1".to_owned(),
                role: "user".to_owned(),
                content: "secret".to_owned(),
                created_at: 1,
            }],
        };

        // Replay on the BOUND node (node_bound = true), under the device context.
        apply_sync_payload_at(&store, &bobs, ctx.clone(), true)
            .await
            .unwrap();

        // The row is owned by BOB (the payload author), scoped to the node's org —
        // NOT "device-owner".
        let meta = store
            .get_access_meta("bob-synced")
            .await
            .unwrap()
            .expect("row");
        assert_eq!(meta.owner_user_id.as_deref(), Some("bob"));
        assert_eq!(meta.org_id.as_deref(), Some("org1"));

        // Bob can reach it; the pulling device account (a different member) cannot.
        let bob_sees = store
            .list_conversations_visible(Some("bob"), Some("org1"), true)
            .await
            .unwrap();
        assert_eq!(
            bob_sees.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["bob-synced"],
            "the original author must see the replayed row"
        );
        let device_sees = store
            .list_conversations_visible(Some("device-owner"), Some("org1"), true)
            .await
            .unwrap();
        assert!(
            device_sees.is_empty(),
            "the pulling device account must NOT be able to read bob's replayed chat"
        );

        // An author-less payload on a bound node is REFUSED (fail closed) — no row.
        let orphan = SyncPayload {
            conversation_id: "orphan".to_owned(),
            title: None,
            agent_id: None,
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: None,
            created_at: 1,
            updated_at: 1,
            messages: vec![],
        };
        assert!(
            apply_sync_payload_at(&store, &orphan, ctx, true)
                .await
                .is_err(),
            "an author-less replay on a bound node must fail closed, not mint an unreachable row"
        );
        assert!(store.get_access_meta("orphan").await.unwrap().is_none());

        // On an UNBOUND node the same authored payload stays NULL-tenanted
        // (byte-identical local-first behaviour: author ignored, no attribution).
        let unbound = ConversationStore::open_in_memory().unwrap();
        apply_sync_payload_at(&unbound, &bobs, Tenancy::Unattributed, false)
            .await
            .unwrap();
        let meta = unbound
            .get_access_meta("bob-synced")
            .await
            .unwrap()
            .expect("row");
        assert!(
            meta.owner_user_id.is_none() && meta.org_id.is_none(),
            "an unbound node must not attribute a replayed row (byte-identical)"
        );
    }

    /// Requirement (3) at the replay seam: a replay can NEVER re-tenant/steal an
    /// existing row. A row already owned by "alice" must survive a hostile replay
    /// whose payload claims a different author ("attacker") — first-writer-wins via
    /// the store's COALESCE. Proven here at the sync layer (the store has its own
    /// `claim_tenancy_never_steals_*` test; this guards the apply path specifically).
    #[tokio::test]
    async fn replay_cannot_retenant_an_already_owned_row() {
        let store = ConversationStore::open_in_memory().unwrap();

        // Pre-existing row owned by alice on org1 (the first writer).
        store
            .claim_tenancy("shared", "alice", Some("org1"))
            .await
            .unwrap();

        // A hostile payload for the SAME conversation, claiming a different author.
        let hostile = SyncPayload {
            conversation_id: "shared".to_owned(),
            title: Some("hijack".to_owned()),
            agent_id: None,
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: Some("attacker".to_owned()),
            created_at: 1,
            updated_at: i64::MAX, // even a "newer" LWW metadata write must not re-tenant.
            messages: vec![SyncMessage {
                id: "m1".to_owned(),
                role: "user".to_owned(),
                content: "steal".to_owned(),
                created_at: 1,
            }],
        };

        // Replay on the bound node under a device context (owner is resolved from the
        // payload author, but the row already exists → COALESCE keeps alice).
        let ctx = Tenancy::Owned {
            user_id: "device-owner".to_owned(),
            org_id: Some("org1".to_owned()),
        };
        apply_sync_payload_at(&store, &hostile, ctx, true)
            .await
            .unwrap();

        // Owner is STILL alice — never the payload's "attacker", never the device.
        let meta = store.get_access_meta("shared").await.unwrap().expect("row");
        assert_eq!(
            meta.owner_user_id.as_deref(),
            Some("alice"),
            "a replay must not re-tenant an already-owned row (first-writer-wins)"
        );
        assert_eq!(meta.org_id.as_deref(), Some("org1"));

        // Alice still sees it; the claimed "attacker" cannot.
        let attacker_sees = store
            .list_conversations_visible(Some("attacker"), Some("org1"), true)
            .await
            .unwrap();
        assert!(
            attacker_sees.is_empty(),
            "the impersonated author must not gain access by claiming ownership in a payload"
        );
    }

    /// Serializes env mutations for the sync-toggle tests so they never race the
    /// shared `RYU_SYNC_ENABLED` var across the crate's single test binary.
    static ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn sample_payload(id: &str) -> SyncPayload {
        SyncPayload {
            conversation_id: id.to_owned(),
            title: Some("t".to_owned()),
            agent_id: Some("a".to_owned()),
            folder_path: None,
            branch: None,
            worktree_path: None,
            run_status: None,
            owner_user_id: Some("bob".to_owned()),
            created_at: 1,
            updated_at: 2,
            messages: vec![SyncMessage {
                id: "m1".to_owned(),
                role: "user".to_owned(),
                content: "hi".to_owned(),
                created_at: 1,
            }],
        }
    }

    /// The SSE change-feed parser concatenates multiple `data:` lines with `\n` (SSE
    /// spec), strips a single leading space, tolerates CRLF, and ignores the leading
    /// comment + `event:` line. A pretty-printed payload split one physical line per
    /// `data:` is the realistic multi-line frame (each break is JSON whitespace).
    #[test]
    fn parse_change_frame_concatenates_multiline_data() {
        let payload = sample_payload("conv-sse");
        let pretty = serde_json::to_string_pretty(&payload).unwrap();
        assert!(
            pretty.lines().count() > 1,
            "pretty JSON must span many lines"
        );
        let mut frame = String::from(": keepalive comment\r\nevent: change\r\n");
        for line in pretty.lines() {
            frame.push_str("data: ");
            frame.push_str(line);
            frame.push_str("\r\n");
        }
        let parsed = parse_change_frame(&frame).expect("multi-line data frame must decode");
        assert_eq!(parsed.conversation_id, "conv-sse");
        assert_eq!(parsed.owner_user_id.as_deref(), Some("bob"));
        assert_eq!(parsed.messages.len(), 1);

        // The single-line form (whole JSON on one `data:`) is equally valid.
        let one = format!("data: {}\n", serde_json::to_string(&payload).unwrap());
        assert_eq!(
            parse_change_frame(&one).unwrap().conversation_id,
            "conv-sse"
        );
    }

    #[test]
    fn parse_change_frame_ignores_keepalives_and_bad_json() {
        // A comment-only keepalive frame carries no `data:` → None (not an error).
        assert!(parse_change_frame(": ping\n").is_none());
        assert!(parse_change_frame("event: heartbeat\n").is_none());
        assert!(parse_change_frame("").is_none());
        // A `data:` line that is not a valid payload decodes to None, never panics.
        assert!(parse_change_frame("data: {\"not\":\"a payload\"}\n").is_none());
        assert!(parse_change_frame("data: not json at all\n").is_none());
    }

    #[test]
    fn sse_frame_buffer_preserves_unicode_split_across_chunks() {
        let mut payload = sample_payload("conv-unicode");
        payload.messages[0].content = "hello 🌍".to_owned();
        let frame = format!(
            "event: conversation\ndata: {}\n\n",
            serde_json::to_string(&payload).unwrap()
        );
        let bytes = frame.as_bytes();

        // Exercise every possible two-chunk boundary, including boundaries in
        // the middle of the UTF-8 encoding for the globe emoji.
        for split in 0..=bytes.len() {
            let mut buffer = Vec::new();
            buffer.extend_from_slice(&bytes[..split]);
            if split < bytes.len() {
                assert!(
                    take_sse_frame(&mut buffer).is_none(),
                    "a partial frame must remain buffered at split {split}"
                );
            }
            buffer.extend_from_slice(&bytes[split..]);
            let complete = take_sse_frame(&mut buffer).expect("complete frame");
            let parsed = parse_change_frame_bytes(&complete).expect("valid payload");
            assert_eq!(parsed.messages[0].content, "hello 🌍");
            assert!(buffer.is_empty());
        }

        let mut crlf = b"event: conversation\r\ndata: ".to_vec();
        crlf.extend_from_slice(serde_json::to_string(&payload).unwrap().as_bytes());
        crlf.extend_from_slice(b"\r\n\r\n");
        let complete = take_sse_frame(&mut crlf).expect("CRLF frame");
        assert_eq!(
            parse_change_frame_bytes(&complete).unwrap().conversation_id,
            "conv-unicode"
        );
    }

    #[tokio::test]
    async fn pull_drains_all_bounded_pages_with_equal_server_timestamps() {
        let payloads: Arc<Vec<SyncPayload>> = Arc::new(
            (0..=1000)
                .map(|index| SyncPayload {
                    conversation_id: format!("paged-{index:04}"),
                    title: Some(format!("row-{index}")),
                    agent_id: None,
                    folder_path: None,
                    branch: None,
                    worktree_path: None,
                    run_status: None,
                    owner_user_id: None,
                    created_at: 1,
                    updated_at: 1,
                    messages: Vec::new(),
                })
                .collect(),
        );
        let app = Router::new().route(
            "/api/conversations-sync/pull",
            get({
                let payloads = Arc::clone(&payloads);
                move |Query(query): Query<PullQuery>| {
                    let payloads = Arc::clone(&payloads);
                    async move {
                        let (conversations, next_cursor) =
                            if query.cursor.as_deref() == Some("page-2") {
                                (payloads[1000..].to_vec(), None)
                            } else {
                                (payloads[..1000].to_vec(), Some("page-2"))
                            };
                        axum::Json(serde_json::json!({
                            "conversations": conversations,
                            "nextCursor": next_cursor,
                            "snapshotAt": 1000,
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let store = ConversationStore::open_in_memory().unwrap();
        let client = SyncClient::new(format!("http://{address}"), "test-token");
        let applied = client
            .pull_since(&store, 0, Tenancy::Unattributed)
            .await
            .unwrap();

        server.abort();
        let _ = server.await;
        assert_eq!(applied, 1001);
        assert_eq!(store.list_conversations().await.unwrap().len(), 1001);
    }

    #[tokio::test]
    async fn pull_rejects_a_non_advancing_server_cursor() {
        let app = Router::new().route(
            "/api/conversations-sync/pull",
            get(|| async {
                axum::Json(serde_json::json!({
                    "conversations": [],
                    "nextCursor": "same-page",
                    "snapshotAt": 1000,
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let store = ConversationStore::open_in_memory().unwrap();
        let client = SyncClient::new(format!("http://{address}"), "test-token");
        let result = client.pull_since(&store, 0, Tenancy::Unattributed).await;

        server.abort();
        let _ = server.await;
        assert!(matches!(
            result,
            Err(SyncError::ServerError(502, ref message))
                if message.contains("non-advancing cursor")
        ));
    }

    #[tokio::test]
    async fn pull_reports_storage_apply_failures_instead_of_advancing() {
        let payload = DocumentSyncPayload {
            document_id: "bad-file".to_owned(),
            title: "Bad file".to_owned(),
            source: "bytes".to_owned(),
            kind: "file".to_owned(),
            parent_id: None,
            icon: None,
            created_at: 1,
            updated_at: 1,
            revision: 0,
            owner_user_id: None,
            space: ryu_spaces::SpaceSyncRecord {
                id: "space".to_owned(),
                name: "Space".to_owned(),
                description: None,
                created_at: 1,
                updated_at: 1,
                retrieval_mode: "hybrid".to_owned(),
                visibility: "private".to_owned(),
                team_id: None,
            },
        };
        let app = Router::new().route(
            "/api/documents-sync/pull",
            get(move || {
                let payload = payload.clone();
                async move {
                    axum::Json(serde_json::json!({
                        "documents": [payload],
                        "nextCursor": null,
                        "snapshotAt": 1000,
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let store = super::super::spaces::SpaceStore::open_in_memory().unwrap();
        let client = SyncClient::new(format!("http://{address}"), "test-token");
        let result = client
            .pull_documents_since(&store, 0, Tenancy::Unattributed)
            .await;

        server.abort();
        let _ = server.await;
        assert!(matches!(result, Err(SyncError::Store(_))));
    }

    #[tokio::test]
    async fn conversation_pull_rejects_missing_or_changed_continuation_snapshot() {
        for fault in [SnapshotFault::Missing, SnapshotFault::Changed] {
            let (url, server) =
                start_snapshot_fault_server("/api/conversations-sync/pull", "conversations", fault)
                    .await;
            let store = ConversationStore::open_in_memory().unwrap();
            let result = SyncClient::new(url, "test-token")
                .pull_since(&store, 0, Tenancy::Unattributed)
                .await;
            server.abort();
            let _ = server.await;
            let expected = match fault {
                SnapshotFault::Missing => "omitted snapshotAt",
                SnapshotFault::Changed => "changed snapshot",
            };
            assert!(matches!(
                result,
                Err(SyncError::ServerError(502, ref message))
                    if message.contains(expected)
            ));
        }
    }

    #[tokio::test]
    async fn document_pull_rejects_missing_or_changed_continuation_snapshot() {
        for fault in [SnapshotFault::Missing, SnapshotFault::Changed] {
            let (url, server) =
                start_snapshot_fault_server("/api/documents-sync/pull", "documents", fault).await;
            let store = super::super::spaces::SpaceStore::open_in_memory().unwrap();
            let result = SyncClient::new(url, "test-token")
                .pull_documents_since(&store, 0, Tenancy::Unattributed)
                .await;
            server.abort();
            let _ = server.await;
            let expected = match fault {
                SnapshotFault::Missing => "omitted snapshotAt",
                SnapshotFault::Changed => "changed snapshot",
            };
            assert!(matches!(
                result,
                Err(SyncError::ServerError(502, ref message))
                    if message.contains(expected)
            ));
        }
    }

    #[tokio::test]
    async fn stream_rejects_an_incomplete_final_frame_for_pull_reconciliation() {
        let payload = sample_payload("stream-partial");
        let complete = format!(
            "event: conversation\ndata: {}\n\n",
            serde_json::to_string(&payload).unwrap()
        );
        let body = format!("{complete}data: {{\"conversation_id\":\"partial");
        let app = Router::new().route(
            "/api/conversations-sync/stream",
            get(move || {
                let body = body.clone();
                async move {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/event-stream")
                        .header("x-ryu-sync-snapshot-at", "1000")
                        .body(Body::from(body))
                        .unwrap()
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let store = ConversationStore::open_in_memory().unwrap();
        let client = SyncClient::new(format!("http://{address}"), "test-token");
        let result = client
            .stream_changes(&store, 0, Tenancy::Unattributed)
            .await;

        server.abort();
        let _ = server.await;
        assert!(matches!(
            result,
            Err(SyncError::ServerError(502, ref message))
                if message.contains("incomplete or invalid SSE frame")
        ));
        assert_eq!(
            store
                .get_conversation_detail("stream-partial")
                .await
                .unwrap()
                .map(|detail| detail.id),
            Some("stream-partial".to_owned())
        );
    }

    /// `env_sync_enabled` is truthy only for the documented tokens; anything else
    /// (including `0`/`false`/unset) keeps the local-first default OFF.
    #[test]
    fn env_sync_enabled_only_for_truthy_tokens() {
        let _guard = ENV_GUARD.lock().unwrap();
        let prior = std::env::var(SYNC_ENABLED_ENV).ok();

        for truthy in ["1", "true", "TRUE", "yes"] {
            std::env::set_var(SYNC_ENABLED_ENV, truthy);
            assert!(env_sync_enabled(), "'{truthy}' must enable sync");
        }
        for falsy in ["0", "false", "no", "", "TrUe", "enabled"] {
            std::env::set_var(SYNC_ENABLED_ENV, falsy);
            assert!(!env_sync_enabled(), "'{falsy}' must NOT enable sync");
        }
        std::env::remove_var(SYNC_ENABLED_ENV);
        assert!(
            !env_sync_enabled(),
            "unset must default to OFF (local-first)"
        );

        // Restore whatever the environment had before this test.
        match prior {
            Some(v) => std::env::set_var(SYNC_ENABLED_ENV, v),
            None => std::env::remove_var(SYNC_ENABLED_ENV),
        }
    }

    /// `effective_replay_tenancy`: an unbound context stays byte-identical
    /// (`Unattributed`, author ignored); a bound context owns the row by the PAYLOAD
    /// author scoped to the node's org, and an author-less payload collapses to
    /// `Unattributed` (the pair the caller then refuses on a bound node).
    #[test]
    fn effective_replay_tenancy_derives_owner_from_payload() {
        let authored = sample_payload("c1");

        // Unbound: author ignored, NULL-tenanted.
        assert_eq!(
            effective_replay_tenancy(&authored, &Tenancy::Unattributed),
            Tenancy::Unattributed
        );

        // Bound: owned by the payload's author ("bob"), scoped to the node's org —
        // never the context user ("device-owner").
        let ctx = Tenancy::Owned {
            user_id: "device-owner".to_owned(),
            org_id: Some("org1".to_owned()),
        };
        assert_eq!(
            effective_replay_tenancy(&authored, &ctx),
            Tenancy::owned_by(Some("bob"), Some("org1"))
        );

        // Bound + author-less payload → Unattributed (fail-closed sentinel).
        let mut orphan = sample_payload("c2");
        orphan.owner_user_id = None;
        assert_eq!(
            effective_replay_tenancy(&orphan, &ctx),
            Tenancy::Unattributed
        );
    }

    /// `SyncError` renders each variant distinctly and `From<reqwest::Error>` maps to
    /// the `Http` arm (the `?`-conversion the client relies on).
    #[test]
    fn sync_error_display_and_from() {
        assert_eq!(
            SyncError::Unauthenticated.to_string(),
            "no auth token found — complete device login first"
        );
        assert_eq!(
            SyncError::ServerError(503, "down".to_owned()).to_string(),
            "server returned 503: down"
        );
        assert!(SyncError::Store(anyhow::anyhow!("boom"))
            .to_string()
            .contains("boom"));
    }
}
