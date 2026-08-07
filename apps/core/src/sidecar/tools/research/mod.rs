//! Ryu Research sidecar — the config-driven autoresearch experiment runner.
//!
//! A small, dependency-free Python HTTP service (`apps/research-sidecar`) Core
//! provisions to `~/.ryu/research-sidecar` and spawns on loopback :8087. It runs
//! one experiment at a time inside a git-versioned workspace, parses a single
//! scalar metric (lower = better) from the experiment's stdout, and keeps a git
//! ledger of attempts — the substrate an autoresearch agent loops over
//! (propose edit → run → keep-if-improved-else-reset → append ledger).
//!
//! Placement (Core vs Gateway, AGENTS.md §1): **Core** — it decides *what runs*
//! (which experiment, in which workspace). The chat calls the researcher agent
//! makes still route through the Gateway. Nothing in Core consumes the engine any
//! more: both consumers — the `/api/research/*` data path and the `research__*` MCP
//! tools — are served out-of-process by the `@ryu/research` app itself, which
//! reaches the engine directly over loopback.
//!
//! Lifecycle mirrors [`crate::sidecar::providers::ryutts::RyuTtsManager`]: adopt
//! an already-running server on the port (e.g. `python -m ryu_research`) rather
//! than spawning a competitor; otherwise provision a Python venv and spawn
//! `python -m ryu_research` from the installed sidecar dir. It is **opt-in** —
//! registered so the catalog/routes can reach it, but never in `startup_order`.
//!
//! This module is the kernel side of the research decomposition: the `/api/research/*`
//! proxy handlers and the `research__*` MCP tool contract live in the `ryu-research`
//! crate (`apps-store/research/backend`), which Core no longer links at all — its HTTP
//! surface is served by the app's own sidecar through the generic ext-proxy, and its
//! MCP tools by the app's own `ryu-research mcp` stdio server through the generic
//! `mcp_servers` path. What stays here is the generic sidecar-lifecycle plumbing (the
//! `RyuTtsManager` analog) for the **Python autoresearch engine**.
//!
//! ## Which port this file is about
//!
//! Two different processes, two different ports, and conflating them would make Core
//! fight the app's own sidecar for a socket:
//!
//! - **`RYU_RESEARCH_PORT` / 7995** — the app's *Rust proxy* (`apps-store/research`'s
//!   `sidecars[0]`). Core injects it into that child via the manifest's `port_env`;
//!   nothing in this file touches it.
//! - **[`ENGINE_PORT`] / 8087** — the *Python autoresearch engine* this manager
//!   spawns (`python -m ryu_research`) and health-checks. That is the port below.
//!
//! The engine's address was previously read from the `ryu-research` crate. Severing
//! that dependency relocates the constant rather than introducing one: Core already
//! carried `8087` in [`crate::profile::apply_env_defaults`], which seeds the
//! `RYU_RESEARCH_UPSTREAM` default the client side honours.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Context;

use crate::sidecar::{BoxFuture, HealthStatus, ProcessHandle, Sidecar};

/// Loopback port the **Python autoresearch engine** binds to (see the module docs for
/// why this is not the app sidecar's `RYU_RESEARCH_PORT`). Distinct from llama.cpp
/// (8080), embeddings (8081), rerank (8082), sd (8083), mlx-vlm (8084), tts (8085),
/// whisper (8090). Profile-shifted through [`crate::profile::port`] at the spawn site,
/// and mirrored on the client side by the `RYU_RESEARCH_UPSTREAM` default
/// `profile::apply_env_defaults` seeds — so both halves move together.
const ENGINE_PORT: u16 = 8087;

/// Base URL of the Python autoresearch engine, for this manager's health probes.
///
/// `RYU_RESEARCH_UPSTREAM` first (a bare `host:port` or a full `http(s)://…` URL),
/// else loopback [`ENGINE_PORT`]. Byte-identical to the `research_base_url` the
/// `ryu-research` crate applies on its own side of the wire, deliberately: the app's
/// sidecar and MCP server read the same var, so Core probing a dev engine on :9087
/// while the tools talk to :8087 is not a state either side can get into.
fn engine_base_url() -> String {
    if let Ok(up) = std::env::var("RYU_RESEARCH_UPSTREAM") {
        let up = up.trim();
        if !up.is_empty() {
            if up.starts_with("http://") || up.starts_with("https://") {
                return up.trim_end_matches('/').to_owned();
            }
            return format!("http://{up}");
        }
    }
    format!("http://127.0.0.1:{ENGINE_PORT}")
}

/// Directory holding the installed `ryu_research` package + bundled experiments.
/// Overridable via `RESEARCH_DIR`; defaults to `~/.ryu/research-sidecar`.
pub fn sidecar_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("RESEARCH_DIR") {
        return std::path::PathBuf::from(dir);
    }
    crate::paths::ryu_dir().join("research-sidecar")
}

/// Where per-experiment git workspaces live (`~/.ryu/research-workspaces`).
fn workspaces_dir() -> std::path::PathBuf {
    crate::paths::ryu_dir().join("research-workspaces")
}

// NOTE: the `is_installed()` helper that used to live here is gone. Its only caller
// was the hardcoded `research` row in `sidecar::mcp::server_summaries`, deleted with
// the rest of that Core-side provider. The app's own binary keeps an equivalent
// on-disk check (`SidecarHost::is_installed` in `apps-store/research/backend`), which
// is where the honest answer belongs now that the app owns the surface.

/// Resolve the Python interpreter to run the sidecar with. Prefers an explicit
/// `RESEARCH_PYTHON`, then a venv inside the sidecar dir, then a bare `python3` /
/// `python` on PATH. Mirrors the TTS sidecar's derivation.
fn python_program(dir: &std::path::Path) -> String {
    if let Ok(py) = std::env::var("RESEARCH_PYTHON") {
        return py;
    }
    let venv = if cfg!(target_os = "windows") {
        dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        dir.join(".venv").join("bin").join("python")
    };
    if venv.exists() {
        return venv.to_string_lossy().to_string();
    }
    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

/// Best-effort: ensure the sidecar's Python venv exists. The service is
/// dependency-free (stdlib only), so provisioning just creates the venv — no
/// pip install. Returns `Ok(true)` when a venv is present after the call,
/// `Ok(false)` when the sidecar *code* isn't installed (nothing to provision;
/// dev instead adopts a `python -m ryu_research` process).
pub async fn ensure_runtime() -> anyhow::Result<bool> {
    use crate::sidecar::external_runtime::{self, ExternalRuntimeConfig};

    let dir = sidecar_dir();
    if !dir.exists() {
        return Ok(false);
    }
    if external_runtime::venv_exists(&dir) {
        return Ok(true);
    }
    let cfg = ExternalRuntimeConfig {
        kind: external_runtime::RUNTIME_PYTHON.to_owned(),
        entry: "ryu_research".to_owned(),
        ..Default::default()
    };
    let downloads = crate::downloads::DownloadCenter::with_default_client();
    external_runtime::provision(&cfg, &dir, &downloads)
        .await
        .map(|_| true)
        .map_err(|e| anyhow::anyhow!("provisioning the research runtime failed: {e}"))
}

/// Lifecycle manager for the Ryu Research sidecar (Python stdlib HTTP service).
pub struct ResearchManager {
    process: ProcessHandle,
    /// `true` when a sidecar was already running before we tried to start it
    /// (adopted external). We don't own it, so `stop` leaves it alone.
    adopted_external: Arc<AtomicBool>,
    client: reqwest::Client,
    downloads: Option<crate::downloads::DownloadCenter>,
}

impl ResearchManager {
    pub fn new() -> Self {
        Self {
            process: ProcessHandle::new(),
            adopted_external: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder()
                .user_agent("ryu-core/0.1")
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .expect("reqwest client"),
            downloads: None,
        }
    }

    pub fn with_downloads(mut self, downloads: crate::downloads::DownloadCenter) -> Self {
        self.downloads = Some(downloads);
        self
    }

    /// Returns `true` if a sidecar is already answering `/health` on the port.
    async fn server_reachable(client: &reqwest::Client) -> bool {
        client
            .get(format!("{}/health", engine_base_url()))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

impl Default for ResearchManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for ResearchManager {
    fn name(&self) -> &'static str {
        "research"
    }

    fn is_required(&self) -> bool {
        false
    }

    fn start(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = self.process.clone();
        let adopted_external = Arc::clone(&self.adopted_external);
        let client = self.client.clone();
        Box::pin(async move {
            // Profile-aware port (release 8087, dev 9087, …): the client side is
            // steered to the same port via the `RYU_RESEARCH_UPSTREAM` env default
            // `profile::apply_env_defaults` seeds, so a dev stack never adopts the
            // release stack's engine. On the release profile this is exactly
            // [`ENGINE_PORT`], matching `engine_base_url`'s default.
            let research_port = crate::profile::port(ENGINE_PORT);
            let research_addr = format!("127.0.0.1:{research_port}");

            // Adopt an already-running sidecar (e.g. `python -m ryu_research`)
            // instead of spawning a competitor that would fail to bind the port.
            if Self::server_reachable(&client).await {
                adopted_external.store(true, Ordering::Relaxed);
                tracing::info!(
                    "ryu-research already running on {research_addr} — adopting existing server"
                );
                return Ok(());
            }
            adopted_external.store(false, Ordering::Relaxed);

            let dir = sidecar_dir();
            if !dir.exists() {
                anyhow::bail!(
                    "Ryu Research sidecar not found at {}. Install it (copy `apps-store/research/sidecar` \
                     there), set RESEARCH_DIR to its path, or run `python -m ryu_research` and Core \
                     will adopt it.",
                    dir.display()
                );
            }

            // Ensure the venv exists (dependency-free, so this only bootstraps
            // the interpreter — no pip install). Best-effort: a failure here
            // falls through to a bare `python3` on PATH.
            if let Err(e) = ensure_runtime().await {
                tracing::warn!(
                    "ryu-research venv provisioning failed (falling back to PATH python): {e:#}"
                );
            }

            let program = python_program(&dir);
            tracing::info!(
                "ryu-research starting ({} -m ryu_research, dir={})",
                program,
                dir.display()
            );

            let workspaces = workspaces_dir();
            let _ = std::fs::create_dir_all(&workspaces);
            let env: Vec<(String, String)> = vec![
                // Make `ryu_research` importable without depending on the cwd.
                ("PYTHONPATH".into(), dir.to_string_lossy().to_string()),
                ("RESEARCH_HOST".into(), "127.0.0.1".into()),
                ("RESEARCH_PORT".into(), research_port.to_string()),
                (
                    "RESEARCH_EXPERIMENTS".into(),
                    dir.join("experiments").to_string_lossy().to_string(),
                ),
                (
                    "RESEARCH_WORKSPACES".into(),
                    workspaces.to_string_lossy().to_string(),
                ),
            ];
            let args: Vec<String> = vec!["-m".into(), "ryu_research".into()];
            process
                .start_path_with_env(&program, &args, &env)
                .await
                .with_context(|| {
                    format!(
                        "spawning the Ryu Research sidecar ({program} -m ryu_research). Is Python \
                         installed? See apps-store/research/sidecar/README.md."
                    )
                })?;

            // The stdlib server binds near-instantly.
            tokio::time::timeout(std::time::Duration::from_secs(20), async {
                loop {
                    if tokio::net::TcpStream::connect(&research_addr).await.is_ok() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            })
            .await
            .context("ryu-research did not start within 20s")?;

            tracing::info!("ryu-research started on {research_addr}");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = self.process.clone();
        let adopted_external = Arc::clone(&self.adopted_external);
        Box::pin(async move {
            if adopted_external.swap(false, Ordering::Relaxed) {
                tracing::info!("ryu-research was an adopted external server — leaving it running");
                return Ok(());
            }
            process
                .stop()
                .await
                .context("stopping ryu-research process")?;
            tracing::info!("ryu-research stopped");
            Ok(())
        })
    }

    fn health_check(&self) -> BoxFuture<HealthStatus> {
        let process = self.process.clone();
        let adopted_external = Arc::clone(&self.adopted_external);
        let client = self.client.clone();
        Box::pin(async move {
            let owned_running = process.is_running();
            if !owned_running && !adopted_external.load(Ordering::Relaxed) {
                return HealthStatus::Unhealthy("ryu-research process not running".into());
            }
            match client
                .get(format!("{}/health", engine_base_url()))
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => HealthStatus::Healthy,
                Ok(r) => {
                    HealthStatus::Unhealthy(format!("ryu-research health returned {}", r.status()))
                }
                Err(e) => HealthStatus::Unhealthy(format!("health check failed: {e}")),
            }
        })
    }

    fn is_running(&self) -> bool {
        self.process.is_running() || self.adopted_external.load(Ordering::Relaxed)
    }

    fn pid(&self) -> Option<u32> {
        self.process.pid()
    }

    fn uninstall(&self, delete_data: bool) -> BoxFuture<anyhow::Result<()>> {
        Box::pin(async move {
            crate::sidecar::remove_from_version_store("research");
            if delete_data {
                crate::sidecar::remove_dir(&workspaces_dir()).await;
            }
            tracing::info!("research uninstalled");
            Ok(())
        })
    }
}
