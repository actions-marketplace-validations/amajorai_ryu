//! stable-diffusion.cpp downloader: fetches the prebuilt server binary (plus the
//! `stable-diffusion.dll` it links against) and the default diffusion model(s)
//! so image generation works right after install. The image default is SDXL
//! base (multi-file: UNet GGUF + CLIP-L + CLIP-G + VAE); the video default is
//! Wan2.1 T2V 1.3B (multi-file: transformer GGUF + umt5-xxl + VAE), fetched
//! lazily on first use because it is ~5 GB and GPU-preferred.
//!
//! Like whisper.cpp, stable-diffusion.cpp only publishes prebuilt **Windows**
//! binaries in its GitHub releases. The `sd-*-bin-win-avx2-x64.zip` archive
//! bundles `sd-server.exe` alongside `sd-cli.exe` and `stable-diffusion.dll`, so
//! all of them must be extracted next to each other. macOS / Linux have no
//! prebuilt server asset, so on those platforms we return a clear "build from
//! source" error rather than silently marking the engine installed (the latent
//! `mark_installed`-on-skip bug a real downloader is wired in to avoid).
//!
//! Pinning a release tag (not `/latest`) keeps installs reproducible. The model
//! file is a swappable default, not a lock: `RYU_SD_MODEL` overrides the path the
//! server loads, and the model catalog can install any other diffusion GGUF.

use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::sidecar::download_manager::{
    build_http_client, extract_all_to_dir, ryu_dir, ProgressCallback, VersionStore,
};

/// Pinned stable-diffusion.cpp release that ships the Windows server asset.
/// The release tag this build installs — pinned; see
/// `catalog::registry::installer_pin`.
pub const TARGET_VERSION: &str = "master-700-c2df4e1";

/// Prebuilt sd-server release asset within [`TARGET_VERSION`], per platform. The
/// asset names embed the commit (`master-c2df4e1`), not the full tag, so they are
/// pinned explicitly rather than derived. stable-diffusion.cpp ships prebuilt
/// server binaries for Windows (x64 AVX2), macOS (Apple-Silicon arm64) and Linux
/// (x86_64); each archive bundles `sd-server` alongside the shared library it
/// links against, so the whole archive is extracted into ~/.ryu/bin together.
/// Targets without a matching asset (Intel mac, non-x86_64 Linux) fall through to
/// the build-from-source path in [`StableDiffusionDownloader::ensure_binary`].
#[cfg(target_os = "windows")]
const PLATFORM_ASSET: &str = "sd-master-c2df4e1-bin-win-avx2-x64.zip";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const PLATFORM_ASSET: &str = "sd-master-c2df4e1-bin-Darwin-macOS-15.7.7-arm64.zip";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const PLATFORM_ASSET: &str = "sd-master-c2df4e1-bin-Linux-Ubuntu-24.04-x86_64.zip";

/// Default diffusion model: SDXL base, Q8_0-quantized UNet GGUF (~2.8 GB) plus
/// its standalone CLIP-L / CLIP-G text encoders and VAE. SDXL is the quality
/// bar Unsloth ships as a baseline and runs on the same engine. It is multi-file
/// because the canonical single-file SDXL GGUF (second-state) is auth-gated on
/// Hugging Face; this non-gated mirror publishes the UNet GGUF next to fp16
/// CLIPs + VAE. `sd-server` loads it with `--clip_l --clip_g --vae`.
/// A sensible default, not a lock — override with `RYU_SD_MODEL` or install
/// another diffusion GGUF via the model catalog.
const DEFAULT_MODEL_FILE: &str = "sdxl_base_1.0_Q8_0.gguf";
const DEFAULT_MODEL_URL: &str =
    "https://huggingface.co/HyperX-Sentience/SDXL-GGUF/resolve/main/sdxl_base_1.0_Q8_0.gguf";
const DEFAULT_CLIP_L_FILE: &str = "sdxl_clip_l.safetensors";
const DEFAULT_CLIP_L_URL: &str =
    "https://huggingface.co/HyperX-Sentience/SDXL-GGUF/resolve/main/clip/sdxl_clip_l.safetensors";
const DEFAULT_CLIP_G_FILE: &str = "sdxl_clip_g.safetensors";
const DEFAULT_CLIP_G_URL: &str =
    "https://huggingface.co/HyperX-Sentience/SDXL-GGUF/resolve/main/clip/sdxl_clip_g.safetensors";
const DEFAULT_VAE_FILE: &str = "sdxl_vae.safetensors";
const DEFAULT_VAE_URL: &str =
    "https://huggingface.co/HyperX-Sentience/SDXL-GGUF/resolve/main/vae/sdxl_vae.safetensors";
const MODEL_STORE_KEY: &str = "sd-model:sdxl-base-1.0-q8_0";
const CLIP_L_STORE_KEY: &str = "sd-model:sdxl-clip-l-fp16";
const CLIP_G_STORE_KEY: &str = "sd-model:sdxl-clip-g-fp16";
const VAE_STORE_KEY: &str = "sd-model:sdxl-vae-fp16";

/// Default video model: Wan2.1 T2V 1.3B — the smallest real text-to-video model
/// stable-diffusion.cpp supports (Apache-2.0). Like the image default it is
/// multi-file: the diffusion transformer GGUF (Q8_0, ~1.5 GB) plus the umt5-xxl
/// text encoder (~3.7 GB Q5_K_M) and the Wan 2.1 VAE (~0.35 GB). Video is
/// GPU-preferred and ~5 GB in total, so it is NOT bundled at onboarding — it is
/// downloaded lazily the first time the active diffusion model is a video model
/// (see `StableDiffusionManager::start`). `sd-server` loads it with
/// `--t5xxl --vae`.
pub const VIDEO_MODEL_FILE: &str = "wan2.1_t2v_1.3b-q8_0.gguf";
const VIDEO_MODEL_URL: &str =
    "https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1_t2v_1.3b-q8_0.gguf";
pub const VIDEO_T5XXL_FILE: &str = "umt5-xxl-encoder-Q5_K_M.gguf";
const VIDEO_T5XXL_URL: &str =
    "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q5_K_M.gguf";
pub const VIDEO_VAE_FILE: &str = "wan_2.1_vae.safetensors";
const VIDEO_VAE_URL: &str = "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors";
const VIDEO_MODEL_STORE_KEY: &str = "sd-video:wan2.1-t2v-1.3b-q8_0";
const VIDEO_T5XXL_STORE_KEY: &str = "sd-video:umt5-xxl-q5-k-m";
const VIDEO_VAE_STORE_KEY: &str = "sd-video:wan2.1-vae";

/// Local stems (GGUF filename minus `.gguf`) of the default image and video
/// models. These are the values the `local-diffusion-model` preference stores,
/// and what the spawn side matches against to attach companion files.
pub const IMAGE_DEFAULT_STEM: &str = "sdxl_base_1.0_Q8_0";
pub const VIDEO_DEFAULT_STEM: &str = "wan2.1_t2v_1.3b-q8_0";

fn server_binary_path() -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "sd-server.exe"
    } else {
        "sd-server"
    };
    ryu_dir().join("bin").join(name)
}

pub fn default_model_path() -> PathBuf {
    ryu_dir().join("models").join(DEFAULT_MODEL_FILE)
}

pub fn clip_l_path() -> PathBuf {
    ryu_dir().join("models").join(DEFAULT_CLIP_L_FILE)
}

pub fn clip_g_path() -> PathBuf {
    ryu_dir().join("models").join(DEFAULT_CLIP_G_FILE)
}

pub fn vae_path() -> PathBuf {
    ryu_dir().join("models").join(DEFAULT_VAE_FILE)
}

pub fn video_model_path() -> PathBuf {
    ryu_dir().join("models").join(VIDEO_MODEL_FILE)
}

pub fn video_t5xxl_path() -> PathBuf {
    ryu_dir().join("models").join(VIDEO_T5XXL_FILE)
}

pub fn video_vae_path() -> PathBuf {
    ryu_dir().join("models").join(VIDEO_VAE_FILE)
}

/// URL of the prebuilt sd-server archive for this platform (CPU build — no CUDA,
/// so it runs without extra runtimes). GPU users can swap in a CUDA/Metal build
/// manually. Only compiled on targets that have a `PLATFORM_ASSET`.
#[cfg(any(
    target_os = "windows",
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "x86_64")
))]
fn archive_url() -> String {
    format!(
        "https://github.com/leejet/stable-diffusion.cpp/releases/download/{TARGET_VERSION}/{PLATFORM_ASSET}"
    )
}

pub struct StableDiffusionDownloader {
    client: reqwest::Client,
    on_progress: Option<ProgressCallback>,
}

impl StableDiffusionDownloader {
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
            on_progress: None,
        }
    }

    pub fn with_progress(mut self, cb: ProgressCallback) -> Self {
        self.on_progress = Some(cb);
        self
    }

    /// Ensure both the sd-server binary and the default image model are present.
    /// Returns the installed version string on success. The video model is NOT
    /// fetched here — see [`Self::ensure_video_default`] (lazy, on first use).
    pub async fn ensure_installed(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<String> {
        self.ensure_binary(downloads).await?;
        self.ensure_default_model(downloads).await?;
        Ok(TARGET_VERSION.to_string())
    }

    #[cfg(any(
        target_os = "windows",
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64")
    ))]
    async fn ensure_binary(&self, downloads: &crate::downloads::DownloadCenter) -> Result<()> {
        let dest = server_binary_path();
        let store = VersionStore::load();
        if dest.exists() && store.versions.get("sdcpp").map(String::as_str) == Some(TARGET_VERSION)
        {
            tracing::info!("sd-server {TARGET_VERSION} already installed — skipping");
            return Ok(());
        }

        let url = archive_url();
        tracing::info!("downloading stable-diffusion.cpp from {url}");

        // Download the archive through the center to a deterministic temp dest,
        // then read it back to extract.
        let archive_dest = ryu_dir()
            .join("tmp")
            .join(format!("sdcpp-{TARGET_VERSION}.zip"));
        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Media,
                role: crate::downloads::DownloadRole::Engine,
                label: "stable-diffusion.cpp".to_string(),
                url,
                dest: archive_dest,
                sha256: None,
                version_record: None,
            })
            .await
            .context("downloading stable-diffusion.cpp archive")?;
        let archive = tokio::fs::read(&archive_path)
            .await
            .context("reading downloaded stable-diffusion.cpp archive")?;

        // Extract the whole archive — sd-server links against a sibling shared
        // library (Windows `stable-diffusion.dll`, macOS `.dylib`, Linux `.so`),
        // so they must land in ~/.ryu/bin together.
        let bin = ryu_dir().join("bin");
        let written = tokio::task::spawn_blocking(move || extract_all_to_dir(&archive, &bin))
            .await
            .context("spawn_blocking for zip extraction")??;

        let server_name = server_binary_path()
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("sd-server")
            .to_string();
        if !written.iter().any(|f| f == &server_name) {
            anyhow::bail!(
                "stable-diffusion.cpp archive did not contain {server_name} (got: {})",
                written.join(", ")
            );
        }

        // The zip extractor does not preserve unix exec bits, so the extracted
        // `sd-server` (and any sibling `sd-*` executables) would be non-runnable.
        // Mark them executable on unix (mirrors how the whisper/llama binaries are
        // chmod'd after extraction).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in &written {
                if f.starts_with("sd-") && !f.contains('.') {
                    let path = ryu_dir().join("bin").join(f);
                    if let Ok(meta) = std::fs::metadata(&path) {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&path, perms);
                    }
                }
            }
        }

        VersionStore::set_version_persisted("sdcpp", TARGET_VERSION)
            .context("writing versions.json")?;

        // The extracted binaries are in place; drop the temp archive.
        let _ = tokio::fs::remove_file(&archive_path).await;

        if let Err(e) = crate::sidecar::path_manager::PathManager::add_to_path() {
            tracing::warn!("Failed to add ~/.ryu/bin to PATH: {e}");
        }
        tracing::info!(
            "stable-diffusion.cpp {TARGET_VERSION} installed ({} files) at {}",
            written.len(),
            dest.display()
        );
        Ok(())
    }

    #[cfg(not(any(
        target_os = "windows",
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    async fn ensure_binary(&self, _downloads: &crate::downloads::DownloadCenter) -> Result<()> {
        let dest = server_binary_path();
        if dest.exists() {
            return Ok(());
        }
        anyhow::bail!(
            "stable-diffusion.cpp has no prebuilt server binary for this platform \
             (supported: Windows x64, macOS arm64, Linux x86_64). Build it from source \
             (e.g. `cmake -B build -DSD_BUILD_EXAMPLES=ON && cmake --build build --config \
             Release`) and place the resulting `sd-server` binary at {}.",
            dest.display()
        );
    }

    /// Download the default image model into ~/.ryu/models if absent: the SDXL
    /// UNet GGUF plus its CLIP-L / CLIP-G text encoders and VAE. Honors a
    /// `RYU_SD_MODEL` override pointing at an existing file (companions are then
    /// unknown to the engine, so it is spawned with `-m` alone).
    async fn ensure_default_model(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<()> {
        if let Ok(custom) = std::env::var("RYU_SD_MODEL") {
            if PathBuf::from(&custom).exists() {
                tracing::info!("RYU_SD_MODEL set to existing {custom} — skipping model download");
                return Ok(());
            }
        }

        let models_dir = ryu_dir().join("models");
        tokio::fs::create_dir_all(&models_dir)
            .await
            .context("creating ~/.ryu/models")?;

        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::ImageModel,
            "SDXL base (UNet Q8_0)",
            DEFAULT_MODEL_URL,
            default_model_path(),
            MODEL_STORE_KEY,
            DEFAULT_MODEL_FILE,
        )
        .await?;
        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::ImageModel,
            "SDXL CLIP-L text encoder",
            DEFAULT_CLIP_L_URL,
            clip_l_path(),
            CLIP_L_STORE_KEY,
            DEFAULT_CLIP_L_FILE,
        )
        .await?;
        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::ImageModel,
            "SDXL CLIP-G text encoder",
            DEFAULT_CLIP_G_URL,
            clip_g_path(),
            CLIP_G_STORE_KEY,
            DEFAULT_CLIP_G_FILE,
        )
        .await?;
        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::ImageModel,
            "SDXL VAE",
            DEFAULT_VAE_URL,
            vae_path(),
            VAE_STORE_KEY,
            DEFAULT_VAE_FILE,
        )
        .await?;

        tracing::info!("stable diffusion model installed");
        Ok(())
    }

    /// Download the default video model into ~/.ryu/models if absent: the Wan2.1
    /// T2V 1.3B diffusion transformer plus the umt5-xxl text encoder and Wan VAE.
    /// Called lazily by [`StableDiffusionManager`](crate::sidecar::providers::sdcpp::StableDiffusionManager)
    /// when a video model is the active diffusion model. Each file that already
    /// exists (e.g. the transformer GGUF installed via the model catalog) is
    /// skipped individually.
    pub async fn ensure_video_default(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<()> {
        let models_dir = ryu_dir().join("models");
        tokio::fs::create_dir_all(&models_dir)
            .await
            .context("creating ~/.ryu/models")?;

        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::VideoModel,
            "Wan2.1 T2V 1.3B video model (Q8_0)",
            VIDEO_MODEL_URL,
            video_model_path(),
            VIDEO_MODEL_STORE_KEY,
            VIDEO_MODEL_FILE,
        )
        .await?;
        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::VideoModel,
            "umt5-xxl text encoder (Q5_K_M)",
            VIDEO_T5XXL_URL,
            video_t5xxl_path(),
            VIDEO_T5XXL_STORE_KEY,
            VIDEO_T5XXL_FILE,
        )
        .await?;
        self.ensure_file(
            downloads,
            crate::downloads::DownloadKind::Media,
            crate::downloads::DownloadRole::VideoModel,
            "Wan 2.1 VAE",
            VIDEO_VAE_URL,
            video_vae_path(),
            VIDEO_VAE_STORE_KEY,
            VIDEO_VAE_FILE,
        )
        .await?;

        tracing::info!("Wan2.1 video model installed");
        Ok(())
    }

    /// Download one diffusion weight file unless it is already installed (file
    /// present AND recorded in the version store). Each file carries its own
    /// store key so the fast-path skip works per artifact.
    async fn ensure_file(
        &self,
        downloads: &crate::downloads::DownloadCenter,
        kind: crate::downloads::DownloadKind,
        role: crate::downloads::DownloadRole,
        label: &str,
        url: &str,
        dest: PathBuf,
        store_key: &str,
        version: &str,
    ) -> Result<()> {
        if dest.exists() && VersionStore::load().checksums.contains_key(store_key) {
            tracing::info!("{label} already installed — skipping");
            return Ok(());
        }

        tracing::info!("downloading {label} from {url}");
        downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind,
                role,
                label: label.to_string(),
                url: url.to_string(),
                dest,
                sha256: None,
                version_record: Some(crate::downloads::VersionRecord {
                    store_key: store_key.to_string(),
                    version: version.to_string(),
                }),
            })
            .await
            .context(format!("downloading {label}"))?;
        Ok(())
    }
}

impl Default for StableDiffusionDownloader {
    fn default() -> Self {
        Self::new()
    }
}
