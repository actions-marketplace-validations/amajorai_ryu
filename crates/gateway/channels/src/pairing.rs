//! DM pairing and per-conversation access policy.
//!
//! The original gate ([`crate::channel_chat_allowed`]) was a flat, env-configured
//! chat allowlist: a chat id was either listed or the channel was closed. That is
//! safe but unusable for a bot the operator wants strangers to be able to start a
//! DM with — the operator had to read the chat id out of a log and edit an env
//! var before the bot would say a single word.
//!
//! Pairing replaces that dance. An unknown DM sender is answered with a one-time
//! **pairing code**; the operator approves the code from Ryu, and from then on
//! that sender is paired and talks to the bot normally. Nothing is admitted until
//! a human approves, so the default stays closed — the security property the flat
//! allowlist had — while the enrolment step moves out of the config file.
//!
//! Groups are gated separately ([`GroupPolicy`]): a group is a shared room, so
//! "someone in it typed at the bot" is not consent for the whole room. There is
//! no pairing flow for groups — a group is allowlisted or it is not.
//!
//! The store is a small JSON file so a paired sender survives a gateway restart.
//! It is deliberately NOT the control-plane database: pairing state is per-node
//! runtime data (the same bot token on another node has its own pairings), and
//! the gateway must be able to gate inbound traffic while the control plane is
//! unreachable.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tracing::{info, warn};

/// How long an unapproved pairing code stays valid. After this the sender must
/// message again to get a fresh code — a code left lying around in a chat log
/// should not be approvable a month later.
pub const CODE_TTL: Duration = Duration::from_secs(60 * 60 * 24);
const REPLY_LINK_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 90);
const MAX_REPLY_LINKS: usize = 4096;

/// Characters a pairing code is drawn from. Digits `0`/`1` and letters `O`/`I`
/// are omitted so a code read aloud or off a phone screen is unambiguous.
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/// Length of a generated pairing code.
const CODE_LEN: usize = 6;

/// How a channel treats a **direct message** from a sender it has not seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DmPolicy {
    /// Unknown senders get a one-time pairing code and are held until an operator
    /// approves it. The default: closed to strangers, but self-service to enrol.
    #[default]
    Pairing,
    /// Only senders on the configured allowlist are admitted; everyone else is
    /// dropped silently. No enrolment path.
    Allowlist,
    /// Every DM is admitted. Only sane for a bot whose completions the operator
    /// is happy to pay for on behalf of anyone who finds it.
    Open,
    /// DMs are refused entirely; the bot only works in allowlisted groups.
    Disabled,
}

/// How a channel treats a message in a **group / multi-user** conversation.
///
/// Deliberately narrower than [`DmPolicy`]: there is no pairing flow, because the
/// consent that matters for a room is the operator's, not one member's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupPolicy {
    /// Only allowlisted group/chat ids are served.
    #[default]
    Allowlist,
    /// Any group the bot has been added to is served.
    Open,
    /// The bot never answers in groups.
    Disabled,
}

/// What the gate decided about one inbound message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Route the message to the agent.
    Allow,
    /// Drop the message without replying. Used where replying would leak that the
    /// bot exists to someone the operator never admitted.
    Deny,
    /// Do not route the message; instead reply with this pairing code so the
    /// sender can read it out to the operator.
    Challenge(String),
    /// Do not route; the sender already has a live code awaiting approval. Carries
    /// the existing code so the reply can repeat it rather than mint a second one.
    Pending(String),
}

/// The persisted state of one sender on one platform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum PairState {
    /// A code has been issued and is waiting for operator approval.
    Pending {
        code: String,
        /// Unix seconds when the code was issued, for [`CODE_TTL`] expiry.
        issued_at: u64,
    },
    /// The operator approved this sender; messages flow.
    Paired {
        /// Unix seconds when approval happened. Informational (shown in the UI).
        paired_at: u64,
    },
    /// The operator explicitly blocked this sender. Distinct from "unknown" so a
    /// blocked sender never gets another code by messaging again.
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ReplyLink {
    core_message_ids: Vec<String>,
    updated_at: u64,
}

/// The on-disk shape. A map of `"<platform>:<sender_id>"` → state, plus a version
/// tag so a future format change can migrate rather than silently mis-parse.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PairingFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: HashMap<String, PairState>,
    #[serde(default)]
    reply_links: HashMap<String, ReplyLink>,
}

/// Pairing state for every channel on this node, backed by a JSON file.
///
/// Cloneable and cheap to share: the map lives behind one `Arc<RwLock<_>>`, so all
/// channel loops on a node observe the same approvals the moment they land.
#[derive(Clone)]
pub struct PairingStore {
    inner: Arc<RwLock<PairingFile>>,
    path: Option<PathBuf>,
}

impl PairingStore {
    /// Load the store from `path`, or start empty when the file does not exist.
    /// A corrupt file is logged and treated as empty rather than fatal — a bad
    /// pairing file must not stop the gateway from booting, and "empty" is the
    /// safe direction (everyone re-pairs; nobody is wrongly admitted).
    pub async fn load(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let file = match tokio::fs::read(&path).await {
            Ok(bytes) => match serde_json::from_slice::<PairingFile>(&bytes) {
                Ok(parsed) => {
                    info!(
                        path = %path.display(),
                        entries = parsed.entries.len(),
                        "loaded channel pairing store"
                    );
                    parsed
                }
                Err(err) => {
                    warn!(
                        path = %path.display(),
                        %err,
                        "channel pairing store is unreadable; starting empty (senders must re-pair)"
                    );
                    PairingFile::default()
                }
            },
            Err(_) => PairingFile::default(),
        };
        Self {
            inner: Arc::new(RwLock::new(file)),
            path: Some(path),
        }
    }

    /// An in-memory store with no file behind it. Used by tests and by a gateway
    /// with no writable data dir; pairings then last only as long as the process.
    pub fn ephemeral() -> Self {
        Self {
            inner: Arc::new(RwLock::new(PairingFile::default())),
            path: None,
        }
    }

    /// Persist the current map. Best-effort: a write failure is logged, never
    /// propagated, because losing durability must not drop a live message.
    async fn persist(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let snapshot = { self.inner.read().await.clone() };
        let Ok(bytes) = serde_json::to_vec_pretty(&snapshot) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        if let Err(err) = tokio::fs::write(path, bytes).await {
            warn!(path = %path.display(), %err, "failed to persist channel pairing store");
        }
    }

    /// Persist provider-message → Core-message links next to pairing state so a
    /// delayed reaction still targets the exact assistant row after restart.
    /// The table is TTL-pruned and hard-bounded on every write.
    pub async fn bind_reply_messages(
        &self,
        platform: &str,
        conversation_id: &str,
        provider_message_ids: &[String],
        core_message_ids: &[String],
    ) {
        let now = unix_now();
        let cutoff = now.saturating_sub(REPLY_LINK_TTL.as_secs());
        {
            let mut file = self.inner.write().await;
            file.reply_links.retain(|_, link| link.updated_at >= cutoff);
            for provider_message_id in provider_message_ids {
                if provider_message_id.trim().is_empty() {
                    continue;
                }
                file.reply_links.insert(
                    reply_link_key(platform, conversation_id, provider_message_id),
                    ReplyLink {
                        core_message_ids: core_message_ids.to_vec(),
                        updated_at: now,
                    },
                );
            }
            while file.reply_links.len() > MAX_REPLY_LINKS {
                let Some(oldest) = file
                    .reply_links
                    .iter()
                    .min_by_key(|(_, link)| link.updated_at)
                    .map(|(key, _)| key.clone())
                else {
                    break;
                };
                file.reply_links.remove(&oldest);
            }
        }
        self.persist().await;
    }

    pub async fn reply_message(
        &self,
        platform: &str,
        conversation_id: &str,
        provider_message_id: &str,
    ) -> Option<Vec<String>> {
        let cutoff = unix_now().saturating_sub(REPLY_LINK_TTL.as_secs());
        self.inner
            .read()
            .await
            .reply_links
            .get(&reply_link_key(
                platform,
                conversation_id,
                provider_message_id,
            ))
            .filter(|link| link.updated_at >= cutoff)
            .map(|link| link.core_message_ids.clone())
    }

    /// Look up one sender's state.
    pub async fn get(&self, platform: &str, sender_id: &str) -> Option<PairState> {
        let key = entry_key(platform, sender_id);
        self.inner.read().await.entries.get(&key).cloned()
    }

    /// Every entry, for the operator-facing "pending approvals" list.
    pub async fn list(&self) -> Vec<(String, PairState)> {
        self.inner
            .read()
            .await
            .entries
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Issue (or re-issue) a pairing code for a sender and return it.
    ///
    /// An unexpired pending code is returned as-is: a sender who messages three
    /// times gets one code, not three, so the operator is not asked to choose
    /// between codes that mean the same thing.
    pub async fn challenge(&self, platform: &str, sender_id: &str) -> Decision {
        let key = entry_key(platform, sender_id);
        let now = unix_now();
        {
            let map = self.inner.read().await;
            match map.entries.get(&key) {
                Some(PairState::Paired { .. }) => return Decision::Allow,
                Some(PairState::Blocked) => return Decision::Deny,
                Some(PairState::Pending { code, issued_at })
                    if now.saturating_sub(*issued_at) < CODE_TTL.as_secs() =>
                {
                    return Decision::Pending(code.clone());
                }
                _ => {}
            }
        }
        let code = generate_code(platform, sender_id, now);
        {
            let mut map = self.inner.write().await;
            map.version = 1;
            map.entries.insert(
                key,
                PairState::Pending {
                    code: code.clone(),
                    issued_at: now,
                },
            );
        }
        self.persist().await;
        info!(platform, code = %code, "issued channel pairing code");
        Decision::Challenge(code)
    }

    /// Approve whichever sender holds `code`. Returns the paired entry key, or
    /// `None` when no live entry carries that code (wrong, stale, or already used).
    pub async fn approve_code(&self, code: &str) -> Option<String> {
        let wanted = code.trim().to_ascii_uppercase();
        let now = unix_now();
        let mut approved = None;
        {
            let mut map = self.inner.write().await;
            for (key, state) in map.entries.iter_mut() {
                if let PairState::Pending { code, issued_at } = state {
                    if *code == wanted && now.saturating_sub(*issued_at) < CODE_TTL.as_secs() {
                        approved = Some(key.clone());
                        break;
                    }
                }
            }
            if let Some(key) = &approved {
                map.entries
                    .insert(key.clone(), PairState::Paired { paired_at: now });
            }
        }
        if approved.is_some() {
            self.persist().await;
        }
        approved
    }

    /// Approve a sender directly (operator clicked "allow" on a pending row rather
    /// than typing the code).
    pub async fn approve(&self, platform: &str, sender_id: &str) {
        {
            let mut map = self.inner.write().await;
            map.entries.insert(
                entry_key(platform, sender_id),
                PairState::Paired {
                    paired_at: unix_now(),
                },
            );
        }
        self.persist().await;
    }

    /// Block a sender. Idempotent, and permanent until explicitly removed — a
    /// blocked sender never receives another pairing code.
    pub async fn block(&self, platform: &str, sender_id: &str) {
        {
            let mut map = self.inner.write().await;
            map.entries
                .insert(entry_key(platform, sender_id), PairState::Blocked);
        }
        self.persist().await;
    }

    /// Forget a sender entirely, returning them to "unknown" (so they can pair
    /// again). Used to undo an accidental block.
    pub async fn forget(&self, platform: &str, sender_id: &str) {
        {
            let mut map = self.inner.write().await;
            map.entries.remove(&entry_key(platform, sender_id));
        }
        self.persist().await;
    }
}

/// The access policy for one channel: DM and group rules plus the static
/// allowlists they consult.
#[derive(Debug, Clone, Default)]
pub struct AccessPolicy {
    pub dm: DmPolicy,
    pub group: GroupPolicy,
    /// Sender ids admitted without pairing (`DmPolicy::Allowlist`, and a fast path
    /// under `Pairing`). Empty means "nobody is pre-admitted".
    pub dm_allowlist: Vec<String>,
    /// Group/chat ids admitted under `GroupPolicy::Allowlist`.
    pub group_allowlist: Vec<String>,
    /// Sender ids admitted in an allowlisted group. This is the platform-neutral
    /// equivalent of Hermes' `allow_from` user rule: a known person can address
    /// the bot in a room without opening every room with the same name.
    pub group_sender_allowlist: Vec<String>,
}

impl AccessPolicy {
    /// Decide a **group** message with no store lookup — group rules are static.
    pub fn decide_group(&self, chat_id: &str) -> Decision {
        match self.group {
            GroupPolicy::Disabled => Decision::Deny,
            GroupPolicy::Open => Decision::Allow,
            GroupPolicy::Allowlist => {
                if self.group_allowlist.iter().any(|id| id == chat_id) {
                    Decision::Allow
                } else {
                    Decision::Deny
                }
            }
        }
    }

    /// Decide a group message with both the room and the sender available.
    ///
    /// Sender admission is intentionally an additive fast path: an explicitly
    /// allowed sender may talk in a room even when the room itself is not listed,
    /// but an empty sender allowlist preserves the existing room-only behavior.
    pub fn decide_group_for_sender(&self, chat_id: &str, sender_id: Option<&str>) -> Decision {
        if sender_id.is_some_and(|id| {
            self.group_sender_allowlist
                .iter()
                .any(|allowed| allowed == id)
        }) {
            return Decision::Allow;
        }
        self.decide_group(chat_id)
    }

    /// Decide a **direct message**. `sender_id` is the platform's stable per-user
    /// id where available, falling back to the chat id for platforms where a DM
    /// chat id *is* the user (WhatsApp phone numbers, iMessage handles).
    pub async fn decide_dm(
        &self,
        store: &PairingStore,
        platform: &str,
        sender_id: &str,
    ) -> Decision {
        if self.dm_allowlist.iter().any(|id| id == sender_id) {
            return Decision::Allow;
        }
        match self.dm {
            DmPolicy::Disabled => Decision::Deny,
            DmPolicy::Open => Decision::Allow,
            DmPolicy::Allowlist => Decision::Deny,
            DmPolicy::Pairing => match store.get(platform, sender_id).await {
                Some(PairState::Paired { .. }) => Decision::Allow,
                Some(PairState::Blocked) => Decision::Deny,
                _ => store.challenge(platform, sender_id).await,
            },
        }
    }
}

/// The message sent back to a sender who needs to pair. Kept here (rather than in
/// each adapter) so every channel says the same thing.
pub fn pairing_prompt(code: &str) -> String {
    format!(
        "🔒 This assistant is private.\n\nYour pairing code is *{code}*.\n\nAsk the owner to approve it in Ryu (Settings → Channels → Pending). \
         Once approved, just send your message again."
    )
}

/// `"<platform>:<sender_id>"` — the store's key shape.
fn entry_key(platform: &str, sender_id: &str) -> String {
    format!("{platform}:{sender_id}")
}

fn reply_link_key(platform: &str, conversation_id: &str, provider_message_id: &str) -> String {
    format!("{platform}\0{conversation_id}\0{provider_message_id}")
}

/// Seconds since the Unix epoch, saturating to 0 if the clock is before it.
fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Derive a pairing code from the sender identity plus the issue time.
///
/// A hash rather than a random draw so the crate needs no RNG dependency. The
/// input includes the nanosecond clock, so re-challenging the same sender yields a
/// different code; the code is not a secret to be guessed but a short token the
/// operator retypes, and it is only ever valid alongside the sender it was issued
/// to (approval looks up the entry, so guessing a code cannot admit a *different*
/// sender than the one who holds it).
fn generate_code(platform: &str, sender_id: &str, now: u64) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(platform.as_bytes());
    hasher.update(b"\0");
    hasher.update(sender_id.as_bytes());
    hasher.update(now.to_le_bytes());
    hasher.update(nanos.to_le_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(CODE_LEN)
        .map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_code_uses_unambiguous_alphabet() {
        let code = generate_code("telegram", "42", 1);
        assert_eq!(code.len(), CODE_LEN);
        for ch in code.chars() {
            assert!(
                CODE_ALPHABET.contains(&(ch as u8)),
                "{ch} is not in the code alphabet"
            );
            assert!(!"01OI".contains(ch), "{ch} is visually ambiguous");
        }
    }

    #[tokio::test]
    async fn unknown_sender_is_challenged_then_paired() {
        let store = PairingStore::ephemeral();
        let policy = AccessPolicy {
            dm: DmPolicy::Pairing,
            ..Default::default()
        };

        let first = policy.decide_dm(&store, "telegram", "u1").await;
        let Decision::Challenge(code) = first else {
            panic!("first contact must be challenged, got {first:?}");
        };

        // Messaging again re-serves the SAME code rather than minting a second.
        let second = policy.decide_dm(&store, "telegram", "u1").await;
        assert_eq!(second, Decision::Pending(code.clone()));

        assert_eq!(
            store.approve_code(&code).await.as_deref(),
            Some("telegram:u1")
        );
        assert_eq!(
            policy.decide_dm(&store, "telegram", "u1").await,
            Decision::Allow
        );
    }

    #[tokio::test]
    async fn exact_reply_links_survive_restart() {
        let path = std::env::temp_dir().join(format!(
            "ryu-channel-reply-links-{}-{}.json",
            std::process::id(),
            unix_now()
        ));
        let store = PairingStore::load(&path).await;
        store
            .bind_reply_messages(
                "telegram",
                "channel:bot:chat",
                &["provider-42".to_owned()],
                &["assistant-98".to_owned(), "assistant-99".to_owned()],
            )
            .await;
        drop(store);

        let restored = PairingStore::load(&path).await;
        assert_eq!(
            restored
                .reply_message("telegram", "channel:bot:chat", "provider-42")
                .await,
            Some(vec!["assistant-98".to_owned(), "assistant-99".to_owned()])
        );
        let _ = tokio::fs::remove_file(path).await;
    }

    #[tokio::test]
    async fn reply_links_stay_within_the_hard_limit() {
        let store = PairingStore::ephemeral();
        for index in 0..=MAX_REPLY_LINKS {
            store
                .bind_reply_messages(
                    "telegram",
                    "channel:bot:chat",
                    &[format!("provider-{index}")],
                    &[format!("assistant-{index}")],
                )
                .await;
        }

        assert_eq!(store.inner.read().await.reply_links.len(), MAX_REPLY_LINKS);
    }

    #[tokio::test]
    async fn blocked_sender_never_gets_a_new_code() {
        let store = PairingStore::ephemeral();
        let policy = AccessPolicy::default();
        store.block("telegram", "spammer").await;
        assert_eq!(
            policy.decide_dm(&store, "telegram", "spammer").await,
            Decision::Deny
        );
        // …and forgetting them restores the enrolment path.
        store.forget("telegram", "spammer").await;
        assert!(matches!(
            policy.decide_dm(&store, "telegram", "spammer").await,
            Decision::Challenge(_)
        ));
    }

    #[tokio::test]
    async fn approve_code_rejects_unknown_and_expired_codes() {
        let store = PairingStore::ephemeral();
        assert!(store.approve_code("ZZZZZZ").await.is_none());

        // An expired pending entry is not approvable. Age the entry by rewriting
        // its `issued_at`, then RELEASE the lock before calling `approve_code` —
        // it takes the same write lock, so holding one across the call deadlocks.
        store.challenge("telegram", "u2").await;
        let key = entry_key("telegram", "u2");
        let stale = {
            let mut map = store.inner.write().await;
            let code = match map.entries.get(&key) {
                Some(PairState::Pending { code, .. }) => code.clone(),
                other => panic!("expected pending, got {other:?}"),
            };
            map.entries.insert(
                key.clone(),
                PairState::Pending {
                    code: code.clone(),
                    issued_at: unix_now() - CODE_TTL.as_secs() - 1,
                },
            );
            code
        };
        assert!(
            store.approve_code(&stale).await.is_none(),
            "an expired code must not be approvable"
        );
        // The entry is left pending rather than silently consumed.
        assert!(matches!(
            store.get("telegram", "u2").await,
            Some(PairState::Pending { .. })
        ));
    }

    #[tokio::test]
    async fn dm_policies_gate_as_documented() {
        let store = PairingStore::ephemeral();

        let open = AccessPolicy {
            dm: DmPolicy::Open,
            ..Default::default()
        };
        assert_eq!(open.decide_dm(&store, "t", "x").await, Decision::Allow);

        let disabled = AccessPolicy {
            dm: DmPolicy::Disabled,
            ..Default::default()
        };
        assert_eq!(disabled.decide_dm(&store, "t", "x").await, Decision::Deny);

        // Allowlist admits only listed senders and offers no enrolment path.
        let listed = AccessPolicy {
            dm: DmPolicy::Allowlist,
            dm_allowlist: vec!["known".into()],
            ..Default::default()
        };
        assert_eq!(
            listed.decide_dm(&store, "t", "known").await,
            Decision::Allow
        );
        assert_eq!(listed.decide_dm(&store, "t", "other").await, Decision::Deny);
    }

    #[test]
    fn group_policies_gate_as_documented() {
        let allow = AccessPolicy {
            group: GroupPolicy::Allowlist,
            group_allowlist: vec!["-100".into()],
            ..Default::default()
        };
        assert_eq!(allow.decide_group("-100"), Decision::Allow);
        assert_eq!(allow.decide_group("-200"), Decision::Deny);

        let open = AccessPolicy {
            group: GroupPolicy::Open,
            ..Default::default()
        };
        assert_eq!(open.decide_group("anything"), Decision::Allow);

        let off = AccessPolicy {
            group: GroupPolicy::Disabled,
            ..Default::default()
        };
        assert_eq!(off.decide_group("-100"), Decision::Deny);
    }

    #[test]
    fn group_sender_allowlist_is_an_additive_fast_path() {
        let policy = AccessPolicy {
            group: GroupPolicy::Allowlist,
            group_allowlist: vec!["room-1".into()],
            group_sender_allowlist: vec!["trusted-user".into()],
            ..Default::default()
        };
        assert_eq!(
            policy.decide_group_for_sender("unlisted-room", Some("trusted-user")),
            Decision::Allow
        );
        assert_eq!(
            policy.decide_group_for_sender("unlisted-room", Some("other-user")),
            Decision::Deny
        );
        assert_eq!(
            policy.decide_group_for_sender("room-1", Some("other-user")),
            Decision::Allow
        );
    }

    #[tokio::test]
    async fn store_round_trips_through_a_file() {
        let dir = std::env::temp_dir().join(format!("ryu-pairing-test-{}", unix_now()));
        let path = dir.join("pairing.json");
        let store = PairingStore::load(&path).await;
        store.approve("telegram", "u9").await;

        let reloaded = PairingStore::load(&path).await;
        assert!(matches!(
            reloaded.get("telegram", "u9").await,
            Some(PairState::Paired { .. })
        ));
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
