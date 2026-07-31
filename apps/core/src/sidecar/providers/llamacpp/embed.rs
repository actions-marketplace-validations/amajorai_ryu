//! Local embeddings server — a dedicated llama.cpp `--embeddings` instance.
//!
//! Unlike the chat `LlamaCppManager` (port 8080, mutually-exclusive resident
//! chat engine), this runs a **second** llama-server on port 8081 serving the
//! nomic embedding GGUF, exposing an OpenAI-compatible `/v1/embeddings` endpoint.
//! It runs *alongside* the chat engine so RAG (Spaces + retrieval) gets real
//! semantic embeddings on install with zero setup — `Embedder::from_registry`
//! defaults its base URL here.
//!
//! Placement (Core vs Gateway, CLAUDE.md §1): deciding *which* model serves
//! embeddings is "what runs" → Core. The model + URL are swappable registry
//! defaults (`local_embed_model`), never hardcoded.
//!
//! Lifecycle mirrors the chat engine: ensure the llama.cpp binary + nomic GGUF
//! are present, then spawn `llama-server --embeddings`. If something is already
//! answering on the port we adopt it rather than fighting for the bind.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Context;

use crate::sidecar::providers::llamacpp::{
    process::{LlamaCppProcess, LlamaCppStartOptions},
    LlamaCppDownloader,
};
use crate::sidecar::{BoxFuture, HealthStatus, Sidecar};

/// Canonical (release) loopback port the embeddings server binds to. Distinct
/// from the chat engine's 8080 so both run together. The concrete port is
/// profile-aware — see [`embed_port`].
pub const EMBED_PORT_BASE: u16 = 8081;

/// Profile-aware embeddings port (release 8081, dev 9081, …). The RAG client that
/// dials this resolves the SAME port via the `RYU_EMBED_BASE_URL` env default that
/// `profile::apply_env_defaults` seeds, so spawn and client never diverge.
pub fn embed_port() -> u16 {
    crate::profile::port(EMBED_PORT_BASE)
}

/// Loopback `host:port` the embeddings server binds to (profile-aware).
fn embed_addr() -> String {
    format!("127.0.0.1:{}", embed_port())
}

/// Who owns the embeddings server that answered the port probe — the question the adopt
/// branch of [`Sidecar::start`] has to answer, and the one it used to get wrong.
///
/// Before this enum, *any* answering port was recorded as `adopted_external = true`,
/// including the server **this manager spawned itself**. That made the next
/// [`Sidecar::stop`] a logged no-op which left our own llama-server resident and
/// unstoppable. `llamacpp-embed` is in `startup_order` (`main.rs`), so it is normally
/// our own child that is answering — the mislabel was the common case, not the rare one,
/// and it reached `stop_sidecar`, `uninstall_sidecar` and the idle reaper alike.
///
/// Mirrors `classify.rs`'s and `rerank.rs`'s enums of the same name deliberately: the
/// three llama.cpp satellites duplicate their whole `start`/`stop`/`is_running`/`pid`
/// surface, and a shared helper would have to be hoisted through `mod.rs` for ~15 lines.
/// Kept local so each file's adopt branch reads on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReachableServer {
    /// The child this manager spawned on an earlier start is still held: we own it,
    /// so `stop` must kill it and `is_running` must report the handle's state.
    OurChild,
    /// A server this manager did not spawn — an operator's own `llama-server`, a
    /// leftover from a previous Core process, another profile pointed at this port.
    /// Hands off: we hold no `Child` for it, so we could not stop it even if we tried.
    Foreign,
}

/// Lifecycle manager for the dedicated llama.cpp embeddings sidecar.
pub struct LlamaCppEmbedManager {
    running: Arc<AtomicBool>,
    process: Arc<Mutex<Option<LlamaCppProcess>>>,
    /// `true` when the reachable embeddings server is one this manager did NOT spawn
    /// ([`ReachableServer::Foreign`]) — never merely because a server was up when we
    /// looked. `stop` skips killing on this flag, so recording it for our own child is
    /// what made that child unstoppable.
    ///
    /// It is not what *protects* a foreign process: we hold no `Child` for one, so
    /// `stop` has nothing to kill either way. The flag's real job is to keep `stop` from
    /// reporting a kill it did not perform, and to let [`Sidecar::is_running`] answer
    /// for a server whose liveness we cannot see through a handle.
    adopted_external: Arc<AtomicBool>,
    client: reqwest::Client,
    /// Global download center (#456), injected at construction in `main.rs`.
    downloads: Option<crate::downloads::DownloadCenter>,
}

impl LlamaCppEmbedManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            process: Arc::new(Mutex::new(None)),
            adopted_external: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .user_agent("ryu-core/0.1")
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .expect("reqwest client"),
            downloads: None,
        }
    }

    /// Inject the global download center (called at the `main.rs` build site).
    pub fn with_downloads(mut self, downloads: crate::downloads::DownloadCenter) -> Self {
        self.downloads = Some(downloads);
        self
    }

    fn binary_path() -> std::path::PathBuf {
        let name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        crate::paths::ryu_dir().join("bin").join(name)
    }

    /// Classify a reachable embeddings port: is the server that answered the child we
    /// spawned, or one we do not own?
    ///
    /// The predicate is "do we hold an OS child handle" — `pid()`, which is `Some`
    /// exactly while `LlamaCppProcess::child` is `Some` (`process.rs`). We spawned that
    /// child on this very port and llama-server holds its listener for its whole life,
    /// so a held handle plus an answering port means the answer came from us.
    ///
    /// It is a *presumption*, not a proof: if our child exited and something else then
    /// bound the port, this says [`ReachableServer::OurChild`] for a server we do not
    /// own. That direction is harmless — `stop` kills the pid in the handle we hold and
    /// nothing else, so it reaps our dead child and never touches the squatter. The
    /// opposite mistake is the one that costs a resident process, which is why the
    /// predicate errs toward "ours".
    ///
    /// **Why not `LlamaCppProcess::is_running()`** (the obvious call): it is
    /// `child.is_some() && binary_path.exists()` (`process.rs`), so a llama.cpp binary
    /// deleted or moved under a running server flips it to `false` while our child is
    /// still alive and serving. That would classify our own child as
    /// [`ReachableServer::Foreign`] and leak the process on `stop` — the same
    /// unstoppable-server bug from the other direction. Ownership is about the handle,
    /// not about the binary.
    fn reachable_server_owner(process: &Mutex<Option<LlamaCppProcess>>) -> ReachableServer {
        if Self::holds_own_child(process) {
            ReachableServer::OurChild
        } else {
            ReachableServer::Foreign
        }
    }

    /// Do we hold an OS child handle for a server we spawned?
    ///
    /// One predicate, two callers on purpose: [`Self::reachable_server_owner`] (who
    /// owns the answering port) and the own-child arm of [`Sidecar::is_running`] (is
    /// the embeddings server up). They ask the same question of the same slot, and
    /// when they were written separately they disagreed — ownership used `pid()`,
    /// liveness used `LlamaCppProcess::is_running()`, which additionally requires the
    /// llama.cpp binary to still exist on disk. The "why not" paragraph above applies
    /// verbatim.
    ///
    /// What this does NOT claim: that the child is alive. `LlamaCppProcess` never
    /// reaps (`stop` is the only thing that clears the handle), so a child that
    /// exited on its own still reads `true` until something calls `stop`. That is
    /// pre-existing and unchanged by sharing the predicate.
    ///
    /// Scope note: the CHAT engine's `LlamaCppManager` (`llamacpp/mod.rs`) still calls
    /// `LlamaCppProcess::is_running()` for its own liveness. It was left alone — it is
    /// outside this change's files — so the binary-existence term survives there. This
    /// is a statement about these three satellites, not about the whole directory.
    fn holds_own_child(process: &Mutex<Option<LlamaCppProcess>>) -> bool {
        process
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|p| p.pid())
            .is_some()
    }

    /// Record that the port is serving, tagged with who owns the server. Pure over the
    /// two flags (no port, no process) so both arms are unit-testable.
    ///
    /// `store` rather than `fetch_or`: a manager that adopted a foreign server on an
    /// earlier start and later spawned its own child must stop claiming the server is
    /// foreign, or `stop` keeps skipping the child it now owns.
    fn record_reachable_server(
        running: &AtomicBool,
        adopted_external: &AtomicBool,
        owner: ReachableServer,
    ) {
        adopted_external.store(owner == ReachableServer::Foreign, Ordering::Relaxed);
        running.store(true, Ordering::Relaxed);
    }

    /// `true` if an embeddings server already answers on the port.
    async fn server_reachable(client: &reqwest::Client) -> bool {
        client
            .get(format!("http://{}/health", embed_addr()))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

impl Default for LlamaCppEmbedManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for LlamaCppEmbedManager {
    fn name(&self) -> &'static str {
        "llamacpp-embed"
    }

    fn is_required(&self) -> bool {
        false
    }

    fn start(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = Arc::clone(&self.process);
        let running = Arc::clone(&self.running);
        let adopted_external = Arc::clone(&self.adopted_external);
        let client = self.client.clone();
        let downloads = self.downloads.clone();
        Box::pin(async move {
            let addr = embed_addr();
            // Adopt an already-running embeddings server (e.g. user-managed) rather
            // than spawning a competing process that would fail to bind the port. The
            // answering server is usually our OWN child from an earlier start, so
            // classify it rather than assuming it is foreign.
            if Self::server_reachable(&client).await {
                let owner = Self::reachable_server_owner(&process);
                Self::record_reachable_server(&running, &adopted_external, owner);
                match owner {
                    ReachableServer::OurChild => tracing::info!(
                        "embeddings server already running on {addr} — our own child is \
                         serving it, nothing to start"
                    ),
                    ReachableServer::Foreign => tracing::info!(
                        "embeddings server already running on {addr} — adopting a server \
                         we did not spawn"
                    ),
                }
                return Ok(());
            }
            // Nothing is answering, so nothing external is being adopted. Whatever we
            // spawn below is ours to stop.
            adopted_external.store(false, Ordering::Relaxed);

            // Ensure the llama.cpp binary is installed (shared with the chat engine).
            let downloads =
                downloads.expect("llamacpp-embed manager: download center not wired (main.rs)");
            LlamaCppDownloader::new()
                .ensure_installed(&downloads)
                .await
                .context("installing llama.cpp for embeddings server")?;

            // Serve the embedding GGUF downloaded by onboarding. This engine does
            // NOT download the model itself — onboarding (`install_local_stack`)
            // is the single owner of model downloads (mirrors the chat engine,
            // which also resolves a pre-downloaded weight). That avoids a
            // concurrent double-download race against onboarding on first boot.
            let registry = crate::registry::ModelRegistry::from_env();
            let model_path = registry.local_embed_model.weight_path();
            if !model_path.exists() {
                anyhow::bail!(
                    "embedding model not found at {} — onboarding may still be downloading it, \
                     or the download failed. The embeddings server will start once the model is \
                     present (it is fetched by default during onboarding).",
                    model_path.display()
                );
            }
            tracing::info!(
                "embeddings server will serve model: {}",
                model_path.display()
            );

            tracing::info!("llamacpp-embed sidecar starting on {addr}");
            let mut proc = LlamaCppProcess::new(Self::binary_path());
            let opts = LlamaCppStartOptions {
                port: embed_port(),
                model_path: Some(model_path),
                // The embedding model is text-only — no vision adapter.
                mmproj_path: None,
                // nomic-embed-text supports 8192-token inputs; set ctx + both
                // batch knobs to match so long messages don't get HTTP 500
                // "input too large" from the default 512-token physical batch.
                ctx_size: 8192,
                embeddings: true,
                reranking: false,
                launch: crate::inference::LaunchConfig {
                    batch_size: Some(8192),
                    ubatch_size: Some(8192),
                    ..Default::default()
                },
            };
            proc.start_with(opts)
                .await
                .context("spawning llama-server (embeddings)")?;
            *process.lock().unwrap() = Some(proc);

            // Wait for the HTTP port to accept connections (model load can take
            // a few seconds even for the small nomic GGUF).
            tokio::time::timeout(std::time::Duration::from_secs(120), async {
                loop {
                    if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            })
            .await
            .context("llamacpp-embed did not start within 120s")?;

            running.store(true, Ordering::Relaxed);
            tracing::info!("llamacpp-embed sidecar started on {addr}");
            Ok(())
        })
    }

    /// Stop the embeddings server we own; leave a foreign one running.
    ///
    /// The early return fires only for a server this manager did NOT spawn. It used to
    /// fire for our own child too (every adopt recorded `adopted_external = true`), so
    /// after the first repeat start this was a logged no-op and the child stayed
    /// resident through `stop_sidecar`, `uninstall_sidecar` and the idle reaper alike.
    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = Arc::clone(&self.process);
        let running = Arc::clone(&self.running);
        let adopted_external = Arc::clone(&self.adopted_external);
        Box::pin(async move {
            running.store(false, Ordering::Relaxed);
            if adopted_external.swap(false, Ordering::Relaxed) {
                tracing::info!("embeddings server was not spawned by us — leaving it running");
                return Ok(());
            }
            let proc = process.lock().unwrap().take();
            if let Some(mut p) = proc {
                if let Err(e) = p.stop().await {
                    tracing::warn!("llamacpp-embed stop error: {e}");
                }
            }
            Ok(())
        })
    }

    fn health_check(&self) -> BoxFuture<HealthStatus> {
        let running = Arc::clone(&self.running);
        let client = self.client.clone();
        Box::pin(async move {
            if !running.load(Ordering::Relaxed) {
                return HealthStatus::Unhealthy("embeddings process not running".into());
            }
            match client
                .get(format!("http://{}/health", embed_addr()))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => HealthStatus::Healthy,
                Ok(resp) => {
                    HealthStatus::Unhealthy(format!("health endpoint returned {}", resp.status()))
                }
                Err(e) => HealthStatus::Unhealthy(format!("health check failed: {e}")),
            }
        })
    }

    /// Two different claims, depending on who owns the server:
    ///
    /// * a **foreign** server we adopted — `true` until [`Sidecar::stop`] clears the
    ///   flag. We hold no handle, so this is the adoption decision being remembered,
    ///   not a liveness check; it can outlive the actual process.
    /// * **our own child** (or nothing) — whether we hold the handle
    ///   ([`Self::holds_own_child`]).
    ///
    /// The own-child arm is what the ownership fix changed: an adopted-our-own-child
    /// start used to take the first branch and return `true` unconditionally. Callers
    /// see the same answer in the normal case — `SidecarManager`'s start guard and
    /// `statuses()` both read it — and a truer one after a stop.
    ///
    /// It asks [`Self::holds_own_child`] and **not** `LlamaCppProcess::is_running()`,
    /// which is `child.is_some() && binary_path.exists()` (`process.rs:188`). The
    /// binary-existence term does not belong in a liveness predicate, and the way it
    /// goes wrong was traced rather than imagined: `LlamaCppManager::uninstall` (the
    /// CHAT engine, `llamacpp/mod.rs`) calls `remove_ryu_binary("llama-server")` →
    /// `tokio::fs::remove_file` on the very path this sidecar's `binary_path()` points
    /// at, because the binary is *shared* and our own `uninstall` deliberately leaves
    /// it alone. Unlinking an executable does not kill the process running it, so an
    /// embeddings server that is up and serving RAG reported `false` here and
    /// `/api/sidecar/status` called a live process stopped — and `llamacpp-embed` is in
    /// `startup_order`, so it is the one of the three most likely to be up when that
    /// happens. `reachable_server_owner` already refused the same term for the same
    /// reason.
    ///
    /// One claim NOT to make here, because it was checked and is false: a llama.cpp
    /// *upgrade* does not open this window. `download_manager::write_flattened` writes
    /// a `.download-tmp` sibling and `std::fs::rename`s it over the destination, so
    /// the path keeps resolving throughout. Only an unlink makes it vanish.
    ///
    /// Exactly what changed: the ONLY state that reads differently is *handle held +
    /// binary gone* — previously `false`, now `true`. Its sub-case where our child is
    /// also dead used to be accidentally right and is now over-reported, but that
    /// sub-case was ALREADY over-reported whenever the binary was present, because
    /// `LlamaCppProcess` does not reap. No liveness information is lost; a term about
    /// a file is.
    fn is_running(&self) -> bool {
        if self.adopted_external.load(Ordering::Relaxed) {
            return true;
        }
        Self::holds_own_child(&self.process)
    }

    fn pid(&self) -> Option<u32> {
        // `None` whenever we hold no child handle — which is exactly the condition
        // `reachable_server_owner` reads as `Foreign`, so a server we did not spawn
        // never reports a pid.
        self.process.lock().unwrap().as_ref().and_then(|p| p.pid())
    }

    fn uninstall(&self, _delete_data: bool) -> BoxFuture<anyhow::Result<()>> {
        Box::pin(async move {
            // The binary is shared with the chat engine — do NOT remove it here.
            // Only drop the version-store marker for this sidecar. The embedding
            // GGUF lives under ~/.ryu/models and is left intact (chat GGUFs share
            // the directory; per-file deletion is out of scope).
            crate::sidecar::remove_from_version_store("llamacpp-embed");
            tracing::info!("llamacpp-embed uninstalled (shared binary + models left intact)");
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ownership is decided by whether we hold an OS child handle — NOT by whether a
    /// server answered. The two `Foreign` cases below are the states in which we
    /// genuinely own nothing, and they are the only ones `stop` may skip.
    #[test]
    fn a_reachable_port_is_foreign_only_when_we_hold_no_child() {
        let empty: Mutex<Option<LlamaCppProcess>> = Mutex::new(None);
        assert_eq!(
            LlamaCppEmbedManager::reachable_server_owner(&empty),
            ReachableServer::Foreign
        );

        // A process struct with no spawned child owns nothing either — `stop()` takes
        // the handle out, so this is also the post-stop state.
        let never_spawned = Mutex::new(Some(LlamaCppProcess::new(
            LlamaCppEmbedManager::binary_path(),
        )));
        assert_eq!(
            LlamaCppEmbedManager::reachable_server_owner(&never_spawned),
            ReachableServer::Foreign
        );
    }

    /// The flag must track the CURRENT owner, not latch on the first adoption, or a
    /// manager that adopted a foreign server once and later spawned its own child would
    /// skip stopping it forever.
    #[test]
    fn recording_a_reachable_server_tracks_ownership_in_both_directions() {
        let running = AtomicBool::new(false);
        let adopted = AtomicBool::new(false);

        LlamaCppEmbedManager::record_reachable_server(&running, &adopted, ReachableServer::Foreign);
        assert!(running.load(Ordering::Relaxed));
        assert!(
            adopted.load(Ordering::Relaxed),
            "a foreign server is adopted"
        );

        LlamaCppEmbedManager::record_reachable_server(
            &running,
            &adopted,
            ReachableServer::OurChild,
        );
        assert!(running.load(Ordering::Relaxed));
        assert!(
            !adopted.load(Ordering::Relaxed),
            "our own child must never be recorded as an external adoption"
        );
    }

    /// The half of the old behaviour that was always correct and must stay correct: a
    /// server we did not spawn is never killed, and `stop` forgets the adoption so a
    /// later start re-decides ownership from scratch.
    #[tokio::test]
    async fn stop_leaves_a_server_we_did_not_spawn_alone() {
        let mgr = LlamaCppEmbedManager::new();
        LlamaCppEmbedManager::record_reachable_server(
            &mgr.running,
            &mgr.adopted_external,
            ReachableServer::Foreign,
        );
        assert!(
            mgr.is_running(),
            "an adopted server reads as the embeddings server being up"
        );
        assert_eq!(mgr.pid(), None, "we hold no child, so there is no pid");

        mgr.stop().await.unwrap();
        assert!(
            !mgr.adopted_external.load(Ordering::Relaxed),
            "stop forgets the adoption"
        );
        assert!(mgr.process.lock().unwrap().is_none());
        assert!(!mgr.is_running());
    }

    /// The regression itself: recording our OWN child must leave `stop` able to reap it.
    /// `llamacpp-embed` is in `startup_order`, so the answering server is normally ours
    /// and the old `store(true)` mislabelled the common case, making every subsequent
    /// `stop_sidecar` / `uninstall_sidecar` / idle-reap a no-op.
    #[test]
    fn our_own_child_is_never_recorded_as_an_adoption() {
        let mgr = LlamaCppEmbedManager::new();
        LlamaCppEmbedManager::record_reachable_server(
            &mgr.running,
            &mgr.adopted_external,
            ReachableServer::OurChild,
        );
        assert!(
            !mgr.adopted_external.load(Ordering::Relaxed),
            "our child must not take stop's leave-it-running branch"
        );
    }
    /// A liveness answer must not be a function of the llama.cpp binary FILE.
    ///
    /// `LlamaCppProcess::is_running()` is `child.is_some() && binary_path.exists()`,
    /// and uninstalling the CHAT engine unlinks `~/.ryu/bin/llama-server` — the binary
    /// this sidecar shares with it and deliberately never removes itself
    /// (`LlamaCppManager::uninstall` → `remove_ryu_binary`). While the file is gone,
    /// that predicate reports a embeddings server that is up
    /// and serving as stopped — `/api/sidecar/status.running = false` for a process
    /// that never stopped answering.
    ///
    /// Unix-only, and it really spawns: `LlamaCppProcess::child` is private and only
    /// `start_with` fills it, so a held handle cannot be faked. The throwaway
    /// executable is a temp-dir shell script (nothing to bind, exits at once) so the
    /// test can delete it out from under the handle, which is the whole point.
    #[cfg(unix)]
    #[tokio::test]
    async fn is_running_ignores_the_shared_binary_being_unlinked_under_a_held_child() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let fake_server = dir.path().join("llama-server");
        std::fs::write(&fake_server, "#!/bin/sh\nexit 0\n").expect("write throwaway server");
        std::fs::set_permissions(&fake_server, std::fs::Permissions::from_mode(0o755))
            .expect("chmod throwaway server");

        let mgr = LlamaCppEmbedManager::new();
        let mut proc = LlamaCppProcess::new(fake_server.clone());
        proc.start_with(LlamaCppStartOptions {
            // Port 0 is never bound — the script ignores its flags and exits. This
            // test is about the handle, not about a listener.
            port: 0,
            model_path: None,
            mmproj_path: None,
            ctx_size: 0,
            embeddings: false,
            reranking: false,
            launch: crate::inference::LaunchConfig::default(),
        })
        .await
        .expect("the throwaway script must spawn, so we hold a real child handle");
        assert!(proc.pid().is_some());
        *mgr.process.lock().unwrap() = Some(proc);
        assert!(mgr.is_running(), "a held child means the server is up");

        // The window: the shared binary is unlinked (what the chat engine's uninstall
        // does), so the path stops resolving. On unix that does not touch a process
        // already running it — nothing about our child changed.
        std::fs::remove_file(&fake_server).expect("remove the binary");
        assert!(!fake_server.exists());
        assert!(
            mgr.is_running(),
            "unlinking the shared binary must not report a serving embeddings server as stopped"
        );
        assert!(mgr.pid().is_some(), "and the pid stays reportable");
        // The ownership predicate must keep agreeing with it — they are one function.
        assert_eq!(
            LlamaCppEmbedManager::reachable_server_owner(&mgr.process),
            ReachableServer::OurChild
        );

        // `stop` is still the only thing that takes the handle out, binary or no binary.
        mgr.stop().await.unwrap();
        assert!(!mgr.is_running());
    }
}
