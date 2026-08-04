//! Device-code pairing: how a client that cannot read `node-auth.token` earns a
//! bearer for THIS node.
//!
//! [`crate::node_token`] made Core authenticate its local API by default. Every
//! surface that runs as a process on the same machine just reads the minted file.
//! Two classes of client cannot:
//!
//!   - **Browser surfaces** — the hosted webapp (`app.ryuhq.com` talks
//!     cross-origin to loopback Core) and the extension. A page cannot read
//!     `~/.ryu/node-auth.token`, and never will be able to.
//!   - **Another machine** — the desktop on a Windows box reaching a self-hosted
//!     Mac mini node. The token is on the mini's disk, not this one's.
//!
//! Both are solved by the same shape the OAuth 2.0 device-authorization grant
//! uses, and which this codebase already speaks in [`crate::auth`] for signing a
//! user in to the CONTROL PLANE: the client asks for a code, a human approves it
//! somewhere already trusted, and the client polls until it gets a credential.
//!
//! The critical difference from [`crate::auth`]: **the verifier here is Core
//! itself**, not Better Auth. This node is the thing being accessed, so it is the
//! thing that decides. That also means pairing works with no network, no account,
//! and no control plane — which matters, because a local-first node must not need
//! an internet round trip to let its own user in.
//!
//! ## What approval requires
//!
//! `POST /api/pair/code` and `POST /api/pair/token` are PUBLIC (an unpaired client
//! has no bearer to present — that is the whole point). Approval is not: it lives
//! behind `require_auth`, so only a caller that ALREADY holds a valid credential
//! can approve a new one. On a laptop that is the desktop app reading the minted
//! file; on a headless cloud node it is the desktop holding the node token from
//! the control plane. Pairing therefore never widens who can get in — it only
//! lets an existing trusted client vouch for another.
//!
//! ## Tokens are stored hashed
//!
//! Only the SHA-256 of an issued token is persisted. Reading
//! `paired-clients.json` yields no usable credential, so a backup, a log, or a
//! stray profile copy does not hand over live access to the node.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// How long an unapproved pairing request stays claimable, in seconds. Long
/// enough for a human to walk to another device, short enough that an abandoned
/// code is not a standing invitation.
pub const PAIRING_CODE_TTL_SECS: u64 = 600;

/// The polling interval handed to clients, in seconds. Clients that poll faster
/// get `slow_down` (mirroring the device-grant contract in [`crate::auth`]).
pub const PAIRING_POLL_INTERVAL_SECS: u64 = 5;

/// Cap on simultaneously-pending requests. Without it, an unauthenticated caller
/// could mint unbounded state through a PUBLIC route — the codes are cheap, but
/// memory is not. Oldest pending requests are evicted first.
pub const MAX_PENDING_REQUESTS: usize = 32;

/// Unix seconds. Split out so tests can drive time without sleeping.
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Where a pairing request is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingState {
    Pending,
    Approved,
    Denied,
}

/// One in-flight pairing request. Lives in memory only: a request that does not
/// survive a Core restart is correct behaviour, because the human who started it
/// is still standing there and can just ask again.
#[derive(Debug, Clone)]
pub struct PairingRequest {
    /// The secret the CLIENT polls with. Never displayed to the human.
    pub device_code: String,
    /// The short, human-readable code shown on both ends so the approver can
    /// confirm they are approving the request actually in front of them.
    pub user_code: String,
    /// Self-declared client label ("Ryu Web", "Chrome extension"). Display only,
    /// and therefore untrusted — it is shown to the approver, never trusted for
    /// an access decision.
    pub client_name: String,
    pub state: PairingState,
    pub created_at: u64,
    /// Set once approved: the plaintext token, held ONLY until the client polls
    /// for it, then dropped. This is the one moment the plaintext exists in
    /// memory; the store keeps just its hash.
    pub issued_token: Option<String>,
}

impl PairingRequest {
    pub fn is_expired(&self, now: u64) -> bool {
        now.saturating_sub(self.created_at) >= PAIRING_CODE_TTL_SECS
    }
}

/// A client that completed pairing and holds a live bearer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedClient {
    pub id: String,
    pub name: String,
    /// SHA-256 hex of the issued token. The plaintext is never persisted, so a
    /// read of this file grants nothing.
    pub token_sha256: String,
    pub created_at: u64,
    /// Last time this token authenticated a request, for the revoke UI. Best
    /// effort: updated opportunistically, not on a write-per-request basis.
    #[serde(default)]
    pub last_seen: u64,
}

/// The persisted set of paired clients.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PairedClients {
    #[serde(default)]
    pub clients: Vec<PairedClient>,
}

/// SHA-256 hex of a token.
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Constant-time hex-digest comparison.
///
/// Both sides are digests, not secrets, so the leak here is small — but the
/// comparison still runs in constant time because `require_auth` performs it on
/// every request against an attacker-supplied bearer, and Core supports
/// non-loopback binds where a byte-by-byte early return is remotely observable.
/// Mirrors `server::ct_eq`.
fn ct_eq_hex(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// A 6-character code from an unambiguous alphabet, formatted `ABC-DEF`.
///
/// Excludes `O`/`0` and `I`/`1`/`L`: a human reads this aloud or retypes it, and
/// a code that is ambiguous on a screen produces failed pairings that look like
/// bugs. 29^6 ≈ 5.9e8 combinations, and a code is only guessable inside its
/// 10-minute window against a live pending request.
fn generate_user_code() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let pick = |rng: &mut rand::rngs::ThreadRng| {
        ALPHABET[rng.gen_range(0..ALPHABET.len())] as char
    };
    let mut rng_ref = rng;
    let left: String = (0..3).map(|_| pick(&mut rng_ref)).collect();
    let right: String = (0..3).map(|_| pick(&mut rng_ref)).collect();
    format!("{left}-{right}")
}

/// A 256-bit random secret, hex-encoded. Used for both `device_code` and the
/// issued bearer.
fn generate_secret(prefix: &str) -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}{hex}")
}

/// The in-memory pending-request table, keyed by `device_code`.
static PENDING: Mutex<Option<HashMap<String, PairingRequest>>> = Mutex::new(None);

fn with_pending<T>(f: impl FnOnce(&mut HashMap<String, PairingRequest>) -> T) -> T {
    let mut guard = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

/// Drop expired requests. Called on every mutation so the table cannot grow
/// without bound from abandoned codes.
fn prune(map: &mut HashMap<String, PairingRequest>, now: u64) {
    map.retain(|_, req| !req.is_expired(now));
}

/// Path to the paired-client store.
pub fn paired_clients_path() -> std::path::PathBuf {
    crate::paths::ryu_dir().join("paired-clients.json")
}

pub fn load_paired_clients() -> PairedClients {
    let Ok(bytes) = std::fs::read(paired_clients_path()) else {
        return PairedClients::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn save_paired_clients(clients: &PairedClients) -> std::io::Result<()> {
    let path = paired_clients_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(clients)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(body.as_bytes())?;
        file.sync_all()?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, body)?;
    }
    Ok(())
}

/// In-memory snapshot of the paired-client store.
///
/// `is_paired_token` runs on the `require_auth` hot path for every request that
/// is not the node token, so it must not stat + parse a JSON file each time.
/// Invalidated explicitly by the two writers (approve, revoke); nothing else
/// mutates the file while Core is running.
static CLIENTS_CACHE: Mutex<Option<PairedClients>> = Mutex::new(None);

fn cached_clients() -> PairedClients {
    let mut guard = CLIENTS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(load_paired_clients).clone()
}

/// Drop the cached snapshot so the next read reloads from disk.
pub fn invalidate_cache() {
    let mut guard = CLIENTS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = None;
}

/// True when `token` matches a paired client. This is what lets `require_auth`
/// admit a paired browser or a remote desktop without them holding `RYU_TOKEN`.
///
/// Compares HASHES in constant time and never short-circuits across the client
/// list on a match position, so neither the digest nor which client matched is
/// leaked by timing.
pub fn is_paired_token(token: &str) -> bool {
    let presented = hash_token(token);
    let clients = cached_clients();
    let mut matched = false;
    for client in &clients.clients {
        // No early `break`: iterate the whole list so the time taken does not
        // reveal the matching client's position.
        matched |= ct_eq_hex(&client.token_sha256, &presented);
    }
    matched
}

/// Start a pairing request. PUBLIC entry point.
pub fn start_request(client_name: &str) -> PairingRequest {
    let now = now_secs();
    let name = client_name.trim();
    let req = PairingRequest {
        device_code: generate_secret("pdc_"),
        user_code: generate_user_code(),
        // Cap the label: it is attacker-controlled and gets rendered in the
        // approval UI.
        client_name: if name.is_empty() {
            "Unknown client".to_owned()
        } else {
            name.chars().take(64).collect()
        },
        state: PairingState::Pending,
        created_at: now,
        issued_token: None,
    };

    with_pending(|map| {
        prune(map, now);
        // Bound the table. Evicting the OLDEST pending request keeps a flood from
        // hiding a request the user is actively trying to approve — the newest
        // one is the one they are looking at.
        while map.len() >= MAX_PENDING_REQUESTS {
            let oldest = map
                .iter()
                .min_by_key(|(_, r)| r.created_at)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(key) => {
                    map.remove(&key);
                }
                None => break,
            }
        }
        map.insert(req.device_code.clone(), req.clone());
    });
    req
}

/// Every request a human could approve right now.
pub fn pending_requests() -> Vec<PairingRequest> {
    let now = now_secs();
    with_pending(|map| {
        prune(map, now);
        let mut out: Vec<PairingRequest> = map
            .values()
            .filter(|r| r.state == PairingState::Pending)
            .cloned()
            .collect();
        out.sort_by_key(|r| r.created_at);
        out
    })
}

/// Outcome of an approve/deny decision.
#[derive(Debug, PartialEq, Eq)]
pub enum DecisionOutcome {
    /// Approved; the client will receive this token on its next poll.
    Approved,
    Denied,
    /// No pending request with that `user_code` (wrong code, or it expired).
    NotFound,
}

/// Approve by the HUMAN-visible `user_code`.
///
/// Keyed on `user_code` rather than `device_code` deliberately: the approver only
/// ever sees the short code, and requiring them to match it is what stops a
/// racing request from being approved by accident.
pub fn approve(user_code: &str) -> DecisionOutcome {
    let now = now_secs();
    let wanted = user_code.trim().to_ascii_uppercase();
    with_pending(|map| {
        prune(map, now);
        let Some(req) = map
            .values_mut()
            .find(|r| r.state == PairingState::Pending && r.user_code == wanted)
        else {
            return DecisionOutcome::NotFound;
        };
        let token = generate_secret("ryup_");
        req.state = PairingState::Approved;
        req.issued_token = Some(token.clone());

        let mut clients = load_paired_clients();
        clients.clients.push(PairedClient {
            id: format!("pc_{}", &hash_token(&token)[..16]),
            name: req.client_name.clone(),
            token_sha256: hash_token(&token),
            created_at: now,
            last_seen: 0,
        });
        // A failed write means the token would authenticate now (it is in the
        // pending entry) but not after a restart. Log loudly rather than fail the
        // approval — the human already consented, and a half-persisted grant is
        // recoverable by re-pairing.
        if let Err(e) = save_paired_clients(&clients) {
            tracing::error!(error = %e, "pairing: approved a client but could not persist it");
        }
        invalidate_cache();
        DecisionOutcome::Approved
    })
}

pub fn deny(user_code: &str) -> DecisionOutcome {
    let now = now_secs();
    let wanted = user_code.trim().to_ascii_uppercase();
    with_pending(|map| {
        prune(map, now);
        match map
            .values_mut()
            .find(|r| r.state == PairingState::Pending && r.user_code == wanted)
        {
            Some(req) => {
                req.state = PairingState::Denied;
                DecisionOutcome::Denied
            }
            None => DecisionOutcome::NotFound,
        }
    })
}

/// What a polling client learns. Mirrors the OAuth device-grant error vocabulary
/// so a client written against that spec behaves correctly here.
#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    /// Approved. The plaintext token, handed over exactly once.
    Token(String),
    AuthorizationPending,
    AccessDenied,
    ExpiredToken,
}

/// Poll with the `device_code`. PUBLIC entry point.
///
/// On success the request is REMOVED, so the plaintext is delivered once and then
/// exists only in the client's storage and as a hash on disk.
pub fn poll(device_code: &str) -> PollOutcome {
    let now = now_secs();
    with_pending(|map| {
        prune(map, now);
        let Some(req) = map.get(device_code) else {
            // Either it never existed or it expired and was pruned. Both are
            // `expired_token` to the client: distinguishing them would confirm
            // whether a guessed device_code was ever real.
            return PollOutcome::ExpiredToken;
        };
        match req.state {
            PairingState::Pending => PollOutcome::AuthorizationPending,
            PairingState::Denied => {
                map.remove(device_code);
                PollOutcome::AccessDenied
            }
            PairingState::Approved => {
                let token = req.issued_token.clone();
                map.remove(device_code);
                match token {
                    Some(t) => PollOutcome::Token(t),
                    None => PollOutcome::ExpiredToken,
                }
            }
        }
    })
}

/// Revoke a paired client by id. Returns true when one was removed.
pub fn revoke(id: &str) -> bool {
    let mut clients = load_paired_clients();
    let before = clients.clients.len();
    clients.clients.retain(|c| c.id != id);
    if clients.clients.len() == before {
        return false;
    }
    if let Err(e) = save_paired_clients(&clients) {
        tracing::error!(error = %e, "pairing: could not persist revocation");
        return false;
    }
    invalidate_cache();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests all drive ONE process-global pending table, so they must not
    /// interleave. Bun-style per-test isolation is not available here; a mutex
    /// held for the body of each test is.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Take the serialization lock and clear the global table.
    fn guard() -> std::sync::MutexGuard<'static, ()> {
        let g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        with_pending(|map| map.clear());
        invalidate_cache();
        g
    }

    #[test]
    fn user_codes_avoid_visually_ambiguous_characters() {
        // A human retypes this. `O` vs `0` and `I`/`1`/`L` produce failed
        // pairings that read as bugs, so the alphabet must exclude them.
        for _ in 0..200 {
            let code = generate_user_code();
            assert_eq!(code.len(), 7, "format is ABC-DEF");
            assert_eq!(code.chars().nth(3), Some('-'));
            for ch in code.chars().filter(|c| *c != '-') {
                assert!(
                    !"O0I1L".contains(ch),
                    "ambiguous character {ch} in user code {code}"
                );
                assert!(ch.is_ascii_uppercase() || ch.is_ascii_digit());
            }
        }
    }

    #[test]
    fn secrets_are_unique_and_prefixed() {
        let a = generate_secret("pdc_");
        let b = generate_secret("pdc_");
        assert_ne!(a, b);
        assert!(a.starts_with("pdc_"));
        // 32 bytes hex + prefix.
        assert_eq!(a.len(), 4 + 64);
    }

    #[test]
    fn hash_is_stable_and_distinguishing() {
        assert_eq!(hash_token("abc"), hash_token("abc"));
        assert_ne!(hash_token("abc"), hash_token("abd"));
        assert_eq!(hash_token("abc").len(), 64);
    }

    #[test]
    fn ct_eq_hex_matches_only_identical_digests() {
        assert!(ct_eq_hex("deadbeef", "deadbeef"));
        assert!(!ct_eq_hex("deadbeef", "deadbeee"));
        // Length mismatch is not a match (and short-circuits — length is public).
        assert!(!ct_eq_hex("dead", "deadbeef"));
    }

    #[test]
    fn a_pending_request_polls_as_pending_then_yields_a_token_once_approved() {
        let _g = guard();
        let req = start_request("Ryu Web");
        assert_eq!(poll(&req.device_code), PollOutcome::AuthorizationPending);

        assert_eq!(approve(&req.user_code), DecisionOutcome::Approved);
        let token = match poll(&req.device_code) {
            PollOutcome::Token(t) => t,
            other => panic!("expected a token, got {other:?}"),
        };
        assert!(token.starts_with("ryup_"));

        // Delivered EXACTLY once: a second poll must not re-issue it, or a
        // replayed device_code would keep harvesting live credentials.
        assert_eq!(poll(&req.device_code), PollOutcome::ExpiredToken);
    }

    #[test]
    fn approval_is_keyed_on_the_human_visible_code_case_insensitively() {
        let _g = guard();
        let req = start_request("Extension");
        assert_eq!(
            approve(&req.user_code.to_ascii_lowercase()),
            DecisionOutcome::Approved
        );
    }

    #[test]
    fn denied_requests_report_access_denied_and_are_dropped() {
        let _g = guard();
        let req = start_request("Ryu Web");
        assert_eq!(deny(&req.user_code), DecisionOutcome::Denied);
        assert_eq!(poll(&req.device_code), PollOutcome::AccessDenied);
        // Dropped after reporting, so it cannot be polled forever.
        assert_eq!(poll(&req.device_code), PollOutcome::ExpiredToken);
    }

    #[test]
    fn an_unknown_device_code_is_indistinguishable_from_an_expired_one() {
        let _g = guard();
        // Confirming "this code was never real" would let an attacker probe for
        // live device codes.
        assert_eq!(poll("pdc_never_existed"), PollOutcome::ExpiredToken);
    }

    #[test]
    fn approving_an_unknown_code_finds_nothing() {
        let _g = guard();
        assert_eq!(approve("ZZZ-ZZZ"), DecisionOutcome::NotFound);
        assert_eq!(deny("ZZZ-ZZZ"), DecisionOutcome::NotFound);
    }

    #[test]
    fn expired_requests_are_pruned_and_never_approvable() {
        let _g = guard();
        let mut req = start_request("Stale");
        // Age it past the TTL in place.
        with_pending(|map| {
            let entry = map.get_mut(&req.device_code).unwrap();
            entry.created_at = now_secs().saturating_sub(PAIRING_CODE_TTL_SECS + 1);
            req.created_at = entry.created_at;
        });
        assert!(req.is_expired(now_secs()));
        assert_eq!(approve(&req.user_code), DecisionOutcome::NotFound);
        assert_eq!(poll(&req.device_code), PollOutcome::ExpiredToken);
        assert!(pending_requests().is_empty());
    }

    #[test]
    fn pending_table_is_bounded_and_evicts_the_oldest_first() {
        let _g = guard();
        // The start route is PUBLIC, so an unauthenticated caller must not be
        // able to grow this without bound.
        let base = now_secs().saturating_sub(60);
        let mut codes = Vec::new();
        for i in 0..(MAX_PENDING_REQUESTS + 10) {
            let req = start_request(&format!("client-{i}"));
            // Force a strictly increasing age ordering so "oldest" is well-defined
            // even when many requests land within the same second.
            // Strictly increasing but still WITHIN the TTL, or `prune` would drop
            // them as expired and the eviction path would never be exercised.
            with_pending(|map| {
                if let Some(entry) = map.get_mut(&req.device_code) {
                    entry.created_at = base + i as u64;
                }
            });
            codes.push(req.device_code);
        }
        let pending = pending_requests();
        assert!(pending.len() <= MAX_PENDING_REQUESTS);
        // The NEWEST request survived — it is the one the user is looking at.
        let newest = codes.last().unwrap();
        assert!(pending.iter().any(|r| &r.device_code == newest));
    }

    #[test]
    fn client_names_are_capped_and_defaulted() {
        let _g = guard();
        // Self-declared and rendered in the approval UI, so it is untrusted input.
        let long = "x".repeat(500);
        let req = start_request(&long);
        assert_eq!(req.client_name.chars().count(), 64);

        let blank = start_request("   ");
        assert_eq!(blank.client_name, "Unknown client");
    }

    #[test]
    fn pending_requests_are_sorted_oldest_first() {
        let _g = guard();
        let a = start_request("first");
        let b = start_request("second");
        // Within the TTL, or both would be pruned before the sort is observed.
        let now = now_secs();
        with_pending(|map| {
            map.get_mut(&a.device_code).unwrap().created_at = now.saturating_sub(60);
            map.get_mut(&b.device_code).unwrap().created_at = now.saturating_sub(30);
        });
        let pending = pending_requests();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].client_name, "first");
    }
}
