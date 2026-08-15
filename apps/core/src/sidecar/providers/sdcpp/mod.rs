//! stable-diffusion.cpp media engine (text-to-image, and text/image-to-video).
//!
//! Like the voice engines (whisper.cpp / parakeet), a generative-media engine is
//! **not** part of the mutually-exclusive `LOCAL_ENGINES` chat-engine swap — you
//! run sd-server *alongside* a resident chat engine. It is therefore managed as
//! an ordinary opt-in sidecar (install / start / stop) and consumed by the Core
//! `POST /api/images/generate` and `POST /api/video/generate` data paths
//! (`server::media`), which proxy requests to this server's OpenAI-compatible
//! `/v1/images/generations` and native `/sdcpp/v1/vid_gen` endpoints.
//!
//! Placement (Core vs Gateway, CLAUDE.md §1): this is **Core** — it decides *what
//! runs* (which local media engine renders the pixels). Per-attribute Gateway
//! routing of image/video slots is a separate, future enhancement.
//!
//! Lifecycle mirrors [`super::whispercpp::WhisperCppManager`]: adopt an
//! already-running server on the port rather than spawning a competing process;
//! otherwise spawn `sd-server` from `~/.ryu/bin` with a diffusion model resolved
//! from `RYU_SD_MODEL` (or the bundled default).

pub mod downloader;

pub use downloader::StableDiffusionDownloader;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Context;

use crate::sidecar::{BoxFuture, HealthStatus, ProcessHandle, Sidecar};

/// Canonical (release) loopback port the sd-server media engine binds to.
/// Distinct from llama.cpp (8080), the embeddings server (8081), and whisper
/// (8090) so they coexist. The concrete port is profile-aware — see [`sd_port`].
pub const SD_PORT_BASE: u16 = 8083;

/// Profile-aware media-engine port (release 8083, dev 9083, …). Both the spawn
/// side (`--listen-port`) and every client (`sd_base_url`) resolve the SAME port
/// through here, so a dev stack never adopts the release stack's sd-server.
pub fn sd_port() -> u16 {
    crate::profile::port(SD_PORT_BASE)
}

/// Loopback `host:port` the media engine binds to (profile-aware).
fn sd_addr() -> String {
    format!("127.0.0.1:{}", sd_port())
}

/// Base URL the media engine serves on once resident. The data paths post to
/// `{base}/v1/images/generations` (image) and `{base}/sdcpp/v1/vid_gen` (video).
pub fn sd_base_url() -> String {
    format!("http://{}", sd_addr())
}

/// How the active diffusion model was chosen — decides which companion files
/// (text encoders / VAE) `sd-server` needs, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModelKind {
    /// `RYU_SD_MODEL` override — a single explicit file, no companions.
    EnvOverride,
    /// The bundled default image model (SDXL) — CLIP-L / CLIP-G / VAE.
    DefaultImage,
    /// The user-selected default image model (SDXL) — CLIP-L / CLIP-G / VAE.
    KnownImage,
    /// The default video model (Wan2.1) — umt5-xxl / VAE, provisioned lazily.
    KnownVideo,
    /// Some other installed diffusion GGUF — single `-m`, no companions.
    Other,
}

/// Resolve the diffusion model and its kind in priority order:
/// 1. `RYU_SD_MODEL` environment variable (testing / manual override).
/// 2. User-selected active diffusion model from preferences
///    (`local-diffusion-model` pref key → stem → `~/.ryu/models/<stem>.gguf`).
/// 3. The bundled default from the downloader.
async fn resolved_model() -> (std::path::PathBuf, ModelKind) {
    if let Ok(p) = std::env::var("RYU_SD_MODEL") {
        return (std::path::PathBuf::from(p), ModelKind::EnvOverride);
    }
    if let Some(stem) = active_diffusion_model_stem().await {
        let path = crate::model_catalog::installed::model_file_path(&stem);
        if path.exists() {
            let kind = if stem == downloader::VIDEO_DEFAULT_STEM {
                ModelKind::KnownVideo
            } else if stem == downloader::IMAGE_DEFAULT_STEM {
                ModelKind::KnownImage
            } else {
                ModelKind::Other
            };
            return (path, kind);
        }
    }
    (downloader::default_model_path(), ModelKind::DefaultImage)
}

/// Read the user's active diffusion model preference (a local GGUF stem). Returns
/// `None` when no preference is set or the preferences store cannot be opened.
async fn active_diffusion_model_stem() -> Option<String> {
    let prefs = crate::server::preferences::PreferencesStore::open_default().ok()?;
    let raw = prefs
        .get(crate::model_catalog::installed::ACTIVE_DIFFUSION_MODEL_PREF)
        .await
        .ok()??;
    let stem = raw.trim();
    if stem.is_empty() {
        return None;
    }
    Some(stem.to_string())
}

/// Extra `sd-server` flags to load a multi-file diffusion model. SDXL and Wan
/// ship as a UNet / diffusion transformer plus separate text encoders and a VAE,
/// so the spawn must pass them explicitly; a single-file GGUF needs only `-m`.
fn companion_args(kind: ModelKind) -> Vec<(String, std::path::PathBuf)> {
    match kind {
        ModelKind::DefaultImage | ModelKind::KnownImage => vec![
            ("--clip_l".to_string(), downloader::clip_l_path()),
            ("--clip_g".to_string(), downloader::clip_g_path()),
            ("--vae".to_string(), downloader::vae_path()),
        ],
        ModelKind::KnownVideo => vec![
            ("--t5xxl".to_string(), downloader::video_t5xxl_path()),
            ("--vae".to_string(), downloader::video_vae_path()),
        ],
        ModelKind::EnvOverride | ModelKind::Other => Vec::new(),
    }
}

/// Lifecycle manager for the stable-diffusion.cpp media sidecar.
pub struct StableDiffusionManager {
    process: ProcessHandle,
    /// `true` when an sd-server was already running before we tried to start it
    /// (adopted external). We don't own it, so `stop` leaves it alone.
    adopted_external: Arc<AtomicBool>,
    client: reqwest::Client,
    /// Global download center (#456); wired by main.rs via [`with_downloads`].
    /// The actual install runs through the engine-install route
    /// (`server::mod`), which passes its own center; this field keeps the
    /// manager uniform with the field-injection fan-out.
    downloads: Option<crate::downloads::DownloadCenter>,
}

impl StableDiffusionManager {
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

    fn binary_path() -> std::path::PathBuf {
        let name = if cfg!(target_os = "windows") {
            "sd-server.exe"
        } else {
            "sd-server"
        };
        crate::paths::ryu_dir().join("bin").join(name)
    }

    /// Returns `true` if an sd-server is already answering on its port. Any HTTP
    /// response (even a 404 to `/`) means a server is bound and reachable.
    async fn server_reachable(client: &reqwest::Client) -> bool {
        client.get(sd_base_url()).send().await.is_ok()
    }
}

impl Default for StableDiffusionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidecar for StableDiffusionManager {
    fn name(&self) -> &'static str {
        "sdcpp"
    }

    fn is_required(&self) -> bool {
        false
    }

    fn start(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = self.process.clone();
        let adopted_external = Arc::clone(&self.adopted_external);
        let client = self.client.clone();
        let downloads = self.downloads.clone();
        Box::pin(async move {
            // Adopt an already-running sd-server rather than spawning a competing
            // process that would fail to bind the port.
            if Self::server_reachable(&client).await {
                adopted_external.store(true, Ordering::Relaxed);
                tracing::info!(
                    "sd-server already running on {} — adopting existing server",
                    sd_addr()
                );
                return Ok(());
            }
            adopted_external.store(false, Ordering::Relaxed);

            let binary_path = Self::binary_path();
            if !binary_path.exists() {
                anyhow::bail!(
                    "sd-server binary not found at {}. Install the stable-diffusion.cpp \
                     media engine from the Store, or place an `sd-server` binary in \
                     ~/.ryu/bin.",
                    binary_path.display()
                );
            }

            let (model, kind) = resolved_model().await;

            // The video default is not bundled at onboarding (~5 GB, GPU-preferred);
            // provision it lazily the first time a video model is selected. Files
            // that already exist (e.g. the transformer GGUF installed via the model
            // catalog) are skipped individually by the downloader.
            if kind == ModelKind::KnownVideo
                && (!downloader::video_model_path().exists()
                    || !downloader::video_t5xxl_path().exists()
                    || !downloader::video_vae_path().exists())
            {
                let dc = downloads.clone().ok_or_else(|| {
                    anyhow::anyhow!(
                        "default video model (Wan2.1) files missing and no download center wired"
                    )
                })?;
                downloader::StableDiffusionDownloader::new()
                    .ensure_video_default(&dc)
                    .await
                    .context("provisioning default Wan2.1 video model")?;
            }

            if !model.exists() {
                anyhow::bail!(
                    "stable diffusion model not found at {}. Install the media engine from \
                     the Store (it bundles a default model), download a diffusion GGUF into \
                     ~/.ryu/models, or set RYU_SD_MODEL to a model path.",
                    model.display()
                );
            }

            tracing::info!("sd-server starting ({})", binary_path.display());

            let mut args: Vec<String> = vec![
                "-m".into(),
                model.to_string_lossy().to_string(),
                "--listen-ip".into(),
                "127.0.0.1".into(),
                "--listen-port".into(),
                sd_port().to_string(),
            ];
            for (flag, path) in companion_args(kind) {
                args.push(flag);
                args.push(path.to_string_lossy().to_string());
            }

            let program = binary_path.to_string_lossy().to_string();
            process
                .start_path_with_args(&program, &args)
                .await
                .context("spawning sd-server process")?;

            // Diffusion weights take a while to load; allow generous startup time.
            let addr = sd_addr();
            tokio::time::timeout(std::time::Duration::from_secs(120), async {
                loop {
                    if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            })
            .await
            .context("sd-server did not start within 120s")?;

            tracing::info!("sd-server started on {addr}");
            Ok(())
        })
    }

    fn stop(&self) -> BoxFuture<anyhow::Result<()>> {
        let process = self.process.clone();
        let adopted_external = Arc::clone(&self.adopted_external);
        Box::pin(async move {
            if adopted_external.swap(false, Ordering::Relaxed) {
                tracing::info!("sd-server was an adopted external server — leaving it running");
                return Ok(());
            }
            process.stop().await.context("stopping sd-server process")?;
            tracing::info!("sd-server stopped");
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
                return HealthStatus::Unhealthy("sd-server process not running".into());
            }
            match client.get(sd_base_url()).send().await {
                Ok(_) => HealthStatus::Healthy,
                Err(e) => HealthStatus::Unhealthy(format!("health check failed: {e}")),
            }
        })
    }

    fn is_running(&self) -> bool {
        self.process.is_running() || self.adopted_external.load(Ordering::Relaxed)
    }

    fn pid(&self) -> Option<u32> {
        // `None` when we adopted an external sd-server we don't own.
        self.process.pid()
    }

    fn uninstall(&self, delete_data: bool) -> crate::sidecar::BoxFuture<anyhow::Result<()>> {
        Box::pin(async move {
            crate::sidecar::remove_ryu_binary("sd-server").await;
            crate::sidecar::remove_ryu_binary("sd-cli").await;
            crate::sidecar::remove_from_version_store("sdcpp");

            if delete_data {
                tracing::info!("sdcpp delete_data: leaving ~/.ryu/models intact");
            }

            tracing::info!("sdcpp uninstalled");
            Ok(())
        })
    }
}
