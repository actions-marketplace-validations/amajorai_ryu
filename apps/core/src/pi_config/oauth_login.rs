//! Subscription OAuth login for the managed Pi (ChatGPT / Claude / Copilot …).
//!
//! The "Login" buttons on the provider cards used to run the agent-advertised ACP
//! method, which for pi-acp is `pi_terminal_login` — a *hint* ("go start pi in a
//! terminal") that answers the RPC in about a second having logged nobody in. The
//! app had no way to complete an interactive login at all: nothing carried a URL,
//! a device code, or a prompt back to the user.
//!
//! This module is that missing channel. It drives pi-ai's OWN flow modules
//! (`@earendil-works/pi-ai/dist/auth/oauth/*`) through a small Node bridge
//! ([`pi_oauth_login.mjs`], embedded below), turning each flow into a stream of
//! events the desktop can render — an authorization URL, a device code, a prompt
//! awaiting an answer — and feeding the user's answers back in.
//!
//! Reusing pi-ai's flows rather than reimplementing OAuth in Rust is deliberate:
//! - the client ids and endpoints stay out of Ryu entirely (contrast
//!   [`super::OAUTH_PROVIDERS`], which had to hardcode refresh parameters and
//!   documents at length why that was defensible);
//! - Copilot works. Its credential is a bespoke GitHub-device → Copilot-token
//!   exchange that the refresh table explicitly refuses to guess at; pi-ai
//!   implements it, so bridging gets it for free;
//! - the credential comes back in exactly the shape Pi stores, so
//!   [`super::provider_configured`] flips to `true` with no translation.
//!
//! The bridge never writes `auth.json` — Core merges the credential itself, so
//! the file keeps the single 0600-owning writer it already had.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::broadcast;

use crate::win_process::NoWindow;

/// The Node bridge, embedded so a built-in Core carries it without the repo.
/// Written into the managed Pi prefix at login time so its
/// `@earendil-works/pi-ai` import resolves from that tree's `node_modules`.
const BRIDGE_SOURCE: &str = include_str!("pi_oauth_login.mjs");

/// Bridge filename inside the managed Pi prefix (`~/.ryu/pi`).
const BRIDGE_FILE: &str = "ryu-oauth-login.mjs";

/// Ceiling on one login attempt. Generous — a user may need to find a password
/// manager, switch devices, or complete an MFA challenge — but not unbounded, so
/// an abandoned attempt cannot hold its callback port (see [`start`]) forever.
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// One in-flight login: the child process, its event history, and a live feed.
pub struct LoginSession {
    /// Live events for subscribers attached now.
    tx: broadcast::Sender<Value>,
    /// Everything emitted so far. A client subscribes AFTER `start` returns, by
    /// which point the flow has usually already emitted its URL or first prompt —
    /// replaying the history is what stops that opening event from being lost.
    history: Mutex<Vec<Value>>,
    /// Write half of the bridge's stdin, for answering prompts.
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    /// Kept so the flow can be killed. Dropping a `tokio` `Child` does NOT reap
    /// it by default, and an orphaned flow keeps its OAuth callback port bound —
    /// `openai-codex` in particular listens on a fixed `localhost:1455` that its
    /// registered redirect URI depends on, so one leaked child makes every later
    /// ChatGPT login fail with `EADDRINUSE`. Every exit path kills.
    child: Mutex<Option<Child>>,
    /// Set once the flow reached a terminal event, so late subscribers do not
    /// wait on a stream that will never speak again.
    finished: AtomicBool,
    /// pi-ai provider id this login is for, so a second attempt at the same
    /// provider can retire the first before it re-binds the callback port.
    provider: String,
}

impl LoginSession {
    /// Append to the replay log and push to live subscribers.
    fn emit(&self, event: Value) {
        if let Ok(mut history) = self.history.lock() {
            history.push(event.clone());
        }
        // `send` errs only when nobody is subscribed; the history still has it.
        let _ = self.tx.send(event);
    }

    /// Events already emitted, for a client that just attached.
    pub fn replay(&self) -> Vec<Value> {
        self.history
            .lock()
            .map(|h| h.clone())
            .unwrap_or_default()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.tx.subscribe()
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(Ordering::SeqCst)
    }

    /// Answer the prompt with the given id. The value is forwarded verbatim: a
    /// `select` prompt (Copilot asks one) expects the chosen option's **id**, not
    /// its index or label.
    pub async fn answer(&self, id: &str, value: &str) -> Result<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| anyhow!("this login is no longer accepting input"))?;
        let line = format!("{}\n", json!({ "id": id, "value": value }));
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Kill the flow and release its callback port. Idempotent.
    pub fn cancel(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.start_kill();
            }
            *guard = None;
        }
        if let Ok(mut guard) = self.stdin.try_lock() {
            *guard = None;
        }
        self.finished.store(true, Ordering::SeqCst);
    }
}

type Registry = Mutex<HashMap<String, Arc<LoginSession>>>;

fn sessions() -> &'static Registry {
    static SESSIONS: OnceLock<Registry> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn get(session_id: &str) -> Option<Arc<LoginSession>> {
    sessions()
        .lock()
        .ok()
        .and_then(|m| m.get(session_id).cloned())
}

/// Drop a session from the registry, killing its child first.
pub fn cancel(session_id: &str) -> bool {
    let removed = sessions().lock().ok().and_then(|mut m| m.remove(session_id));
    match removed {
        Some(session) => {
            session.cancel();
            true
        }
        None => false,
    }
}

/// Write the Node bridge into the managed Pi prefix, refreshing it whenever the
/// embedded copy differs (a Core upgrade must not leave a stale bridge behind).
fn ensure_bridge() -> Result<std::path::PathBuf> {
    let dir = crate::sidecar::adapters::acp::managed_pi_dir();
    if !dir.join("node_modules").is_dir() {
        return Err(anyhow!(
            "the managed Pi engine is not installed yet, so there is no OAuth flow to run — install it from Settings first"
        ));
    }
    let path = dir.join(BRIDGE_FILE);
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    if current != BRIDGE_SOURCE {
        std::fs::write(&path, BRIDGE_SOURCE)?;
    }
    Ok(path)
}

/// The runtimes that can host the bridge, in priority order. Node first,
/// deliberately: the flow modules reach `node:http` / `node:crypto` through an
/// indirection that exists to defeat bundlers, and Node is what pi-ai targets.
const JS_RUNTIMES: [&str; 2] = ["node", "bun"];

/// Resolve a JavaScript runtime for the bridge, as an **absolute path**.
///
/// A bare `PATH` scan for the literal name is not enough, and got this wrong in
/// both directions:
/// - on Windows the interpreter is `node.exe` / `bun.exe`, so probing
///   `<dir>/node` matched nothing on every Windows host — a user with Node
///   installed was told to install Node, and the login 400'd before it started.
///   [`crate::sidecar::manifest_sidecar::which_on_path`] already knows the
///   extension rule (and why `Command::new` cannot spawn a bare `.cmd`), so this
///   reuses it rather than keeping a third, subtly-different copy;
/// - a macOS app launched from Finder inherits a minimal
///   `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) that contains no Node install, so
///   the GUI case fails where a terminal launch works. The common install
///   prefixes are probed explicitly, mirroring
///   `skills_catalog::default_skills::resolve_npx`.
///
/// PATH still wins over the well-known prefixes — a user who put a specific
/// runtime on their PATH meant it.
fn js_runtime() -> Option<std::path::PathBuf> {
    for candidate in JS_RUNTIMES {
        if let Some(found) = crate::sidecar::manifest_sidecar::which_on_path(candidate) {
            return Some(found);
        }
    }
    for candidate in JS_RUNTIMES {
        if let Some(found) = well_known_runtime(candidate) {
            return Some(found);
        }
    }
    None
}

/// Install prefixes a process that did not inherit a login shell's `PATH` still
/// has to look in.
#[cfg(windows)]
fn well_known_runtime(binary: &str) -> Option<std::path::PathBuf> {
    let exe = format!("{binary}.exe");
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        roots.push(
            std::path::PathBuf::from(program_files)
                .join("nodejs")
                .join(&exe),
        );
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = std::path::PathBuf::from(local);
        roots.push(local.join("Programs").join("nodejs").join(&exe));
        // winget shims every package it installs into this one directory.
        roots.push(
            local
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(&exe),
        );
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".bun").join("bin").join(&exe));
    }
    roots.into_iter().find(|p| p.is_file())
}

#[cfg(not(windows))]
fn well_known_runtime(binary: &str) -> Option<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("/opt/homebrew/bin").join(binary),
        std::path::PathBuf::from("/usr/local/bin").join(binary),
        std::path::PathBuf::from("/usr/bin").join(binary),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".bun").join("bin").join(binary));
        roots.push(home.join(".volta").join("bin").join(binary));
        roots.push(home.join(".local").join("bin").join(binary));
        // nvm keeps one bin dir per installed Node version.
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm").join("versions").join("node")) {
            for entry in entries.flatten() {
                roots.push(entry.path().join("bin").join(binary));
            }
        }
    }
    roots.into_iter().find(|p| p.is_file())
}

/// The pi-ai OAuth provider id backing a Ryu provider id. These coincide by
/// construction: Ryu's `auth_key` IS the key Pi writes into `auth.json`, and Pi
/// keys it by the pi-ai provider id (`anthropic`, `openai-codex`,
/// `github-copilot`). Returns `None` for anything that is not a login provider.
pub fn oauth_provider_id(ryu_provider_id: &str) -> Option<&'static str> {
    let meta = super::provider_meta(ryu_provider_id)?;
    if meta.auth_kind != "subscription" || meta.auth_key.is_empty() {
        return None;
    }
    Some(meta.auth_key)
}

/// Merge a completed credential into the managed Pi's `auth.json` under
/// `auth_key`, preserving every other provider's entry.
fn store_credential(auth_key: &str, credential: &Value) -> Result<()> {
    super::ensure_dir()?;
    let mut auth = super::read_auth();
    auth.insert(auth_key.to_owned(), credential.clone());
    let body = serde_json::to_string_pretty(&auth)?;
    super::write_secret_file(&super::auth_path(), &body)
}

/// Begin a subscription login. Returns the session id the client streams from.
///
/// One login at a time per provider: a second attempt cancels the first rather
/// than racing it for the callback port.
pub async fn start(ryu_provider_id: &str) -> Result<String> {
    let provider = oauth_provider_id(ryu_provider_id)
        .ok_or_else(|| anyhow!("\"{ryu_provider_id}\" is not a subscription login provider"))?;
    let bridge = ensure_bridge()?;
    let runtime = js_runtime().ok_or_else(|| {
        anyhow!(
            "no JavaScript runtime found — Ryu looked on PATH and in the usual Node/Bun install \
             locations. Install Node, then try signing in again"
        )
    })?;

    // Retire any earlier attempt for this provider before binding its port again.
    let stale: Vec<String> = sessions()
        .lock()
        .ok()
        .map(|m| {
            m.iter()
                .filter(|(_, s)| s.provider == provider)
                .map(|(id, _)| id.clone())
                .collect()
        })
        .unwrap_or_default();
    for id in stale {
        cancel(&id);
    }

    let mut command = tokio::process::Command::new(runtime);
    command
        .arg(&bridge)
        .arg(provider)
        .current_dir(crate::sidecar::adapters::acp::managed_pi_dir())
        // The flow writes nothing itself, but Pi's own dir is the right context
        // for anything that reads configuration alongside it.
        .env("PI_CODING_AGENT_DIR", super::config_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .no_window();

    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("login bridge produced no stdout"))?;
    let stderr = child.stderr.take();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("login bridge accepted no stdin"))?;

    let (tx, _rx) = broadcast::channel(64);
    let session = Arc::new(LoginSession {
        tx,
        history: Mutex::new(Vec::new()),
        stdin: tokio::sync::Mutex::new(Some(stdin)),
        child: Mutex::new(Some(child)),
        finished: AtomicBool::new(false),
        provider: provider.to_owned(),
    });

    let session_id = format!("login_{}", uuid::Uuid::new_v4().simple());
    if let Ok(mut map) = sessions().lock() {
        map.insert(session_id.clone(), Arc::clone(&session));
    }

    // Reader: turn the bridge's JSONL into session events, and land the
    // credential when the flow completes.
    let auth_key = provider.to_owned();
    let reader_session = Arc::clone(&session);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(trimmed) else {
                tracing::debug!("pi oauth bridge: unparsable line: {trimmed}");
                continue;
            };
            match event.get("type").and_then(Value::as_str) {
                Some("done") => {
                    let credential = event.get("credential").cloned().unwrap_or(Value::Null);
                    match store_credential(&auth_key, &credential) {
                        Ok(()) => reader_session.emit(json!({
                            "type": "success",
                            "provider": auth_key,
                        })),
                        Err(e) => reader_session.emit(json!({
                            "type": "error",
                            "message": format!("signed in, but the credential could not be saved: {e}"),
                        })),
                    }
                    reader_session.finished.store(true, Ordering::SeqCst);
                }
                Some("error") => {
                    reader_session.emit(event);
                    reader_session.finished.store(true, Ordering::SeqCst);
                }
                // The credential must never reach a client; every other event is
                // UI-facing and forwarded as-is.
                _ => reader_session.emit(event),
            }
        }
        // Stream closed. If the child died without a terminal event, say so
        // rather than leaving the desktop on a spinner forever.
        if !reader_session.is_finished() {
            reader_session.emit(json!({
                "type": "error",
                "message": "the login flow exited before completing",
            }));
            reader_session.finished.store(true, Ordering::SeqCst);
        }
        reader_session.cancel();
    });

    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("pi oauth bridge stderr: {line}");
            }
        });
    }

    // Backstop: never let an abandoned attempt hold its callback port.
    let timeout_id = session_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(LOGIN_TIMEOUT).await;
        if let Some(session) = get(&timeout_id) {
            if !session.is_finished() {
                session.emit(json!({
                    "type": "error",
                    "message": "the login timed out — start it again",
                }));
            }
        }
        cancel(&timeout_id);
    });

    Ok(session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pi-ai OAuth provider id for a Ryu provider is its `auth.json` key.
    /// These coincide by construction, and the login writes the credential under
    /// exactly the key `provider_configured` reads — so if this mapping ever
    /// drifts, a completed login would leave the card saying "Not connected".
    #[test]
    fn subscription_providers_map_to_their_auth_keys() {
        assert_eq!(oauth_provider_id("claude-pro-max"), Some("anthropic"));
        assert_eq!(oauth_provider_id("openai-codex"), Some("openai-codex"));
        assert_eq!(oauth_provider_id("github-copilot"), Some("github-copilot"));
        // Not a login provider: an api-key provider has nothing to log into.
        assert_eq!(oauth_provider_id("openai"), None);
        assert_eq!(oauth_provider_id("nope"), None);
    }

    /// The runtime probe must find an interpreter by its PLATFORM file name, not
    /// by the bare literal. Probing `<dir>/node` is what made every Windows host
    /// (where it is `node.exe`) answer "no JavaScript runtime found" and fail the
    /// login with a 400 before the flow ever started. `sh`/`cmd` stand in for the
    /// interpreters here because they are the only executables guaranteed to be
    /// present on a CI box — the lookup is the same one.
    #[test]
    fn the_runtime_probe_resolves_by_platform_file_name() {
        #[cfg(unix)]
        let known = "sh";
        #[cfg(windows)]
        let known = "cmd";
        assert!(
            crate::sidecar::manifest_sidecar::which_on_path(known).is_some(),
            "the probe backing js_runtime cannot find {known}"
        );
        let missing =
            crate::sidecar::manifest_sidecar::which_on_path("definitely-not-a-real-runtime-xyz");
        assert!(missing.is_none());
    }

    /// A completed login must land in `auth.json` WITHOUT disturbing any other
    /// provider's entry, and must be visible to the same check the provider card
    /// renders from.
    #[test]
    fn storing_a_credential_connects_that_provider_and_preserves_others() {
        crate::pi_config::tests::with_temp_dir(|| {
            super::super::set_auth_key("openai", "sk-existing").expect("seed api key");
            assert_eq!(
                super::super::subscription_login_present("claude-pro-max"),
                Some(false),
                "not connected before the login"
            );

            store_credential(
                "anthropic",
                &json!({ "type": "oauth", "access": "tok", "refresh": "ref" }),
            )
            .expect("store credential");

            assert_eq!(
                super::super::subscription_login_present("claude-pro-max"),
                Some(true),
                "the card flips to Connected off the stored credential"
            );
            // The unrelated api-key entry survives the merge.
            let auth = super::super::read_auth();
            assert_eq!(
                auth.get("openai")
                    .and_then(|v| v.get("key"))
                    .and_then(|v| v.as_str()),
                Some("sk-existing")
            );
        });
    }
}
