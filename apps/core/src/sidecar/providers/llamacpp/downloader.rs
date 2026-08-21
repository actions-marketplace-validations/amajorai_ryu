//! llama.cpp downloader. Pulls the platform release archive (`.zip` on Windows,
//! `.tar.gz` on macOS/Linux) and extracts the binary, plus GGUF weight download
//! for the bundled local chat model.
//!
//! **Which** archive is pulled is the [`variant`](super::variant) question: the
//! CPU build, or an accelerated one (Metal/CUDA/Vulkan), auto-detected from the
//! machine's GPU unless the user pinned a choice. One variant is installed at a
//! time, into its own directory, and switching wipes the previous one.

use std::path::PathBuf;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use super::variant::{self, LlamaVariant};
use crate::registry::{LocalModelEntry, ModelRegistry};
use crate::sidecar::download_manager::{
    build_http_client, extract_binary_with_libs, ryu_dir, ProgressCallback, VersionStore,
};

// ── Paths ──────────────────────────────────────────────────────────────────────

fn bin_path() -> PathBuf {
    variant::server_path()
}

// b10218 includes llama.cpp's request-armed reasoning control, which lets Core
// ask a running local completion to leave its reasoning block early. It also
// retains the MTP speculative-decoding flags used by the inference controls.
// NOTE: b9xxx removed `--draft-max`/`--draft-min` in favour of
// `--spec-draft-n-max`/`--spec-draft-n-min` (see `inference::LaunchConfig`).
/// The release tag this build installs. Pinned at compile time: `archive_url()`
/// is derived from it, so this is the ONLY version `ensure_installed` can
/// deliver — upstream's newer tags are unreachable without a code change.
/// `catalog::registry::installer_pin` reads it so the catalog advertises the
/// deliverable version instead of GitHub's latest (which produced a permanent
/// "update available" row whose Update button could never do anything).
pub const TARGET_VERSION: &str = "b10218";

/// Release-archive URL for `variant` on this platform. Every variant resolves
/// through [`LlamaVariant::asset_slug`], so the URL and the "can this node run
/// it" gate can never disagree about which asset exists.
fn archive_url(variant: LlamaVariant) -> Result<String> {
    let tag = TARGET_VERSION;
    let platform = variant.asset_slug().ok_or_else(|| {
        anyhow::anyhow!(
            "llama.cpp publishes no {} build for {}-{}",
            variant.as_str(),
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let ext = archive_ext();
    Ok(format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{tag}/llama-{tag}-bin-{platform}.{ext}"
    ))
}

/// The CUDA runtime archive that a Windows CUDA build needs beside it. Upstream
/// ships the `ggml-cuda` backend and the CUDA runtime DLLs as **two** archives;
/// installing only the first yields a `llama-server.exe` that fails to load its
/// backend at startup. `None` for every non-CUDA variant.
fn cudart_url(variant: LlamaVariant) -> Option<String> {
    if variant != LlamaVariant::Cuda {
        return None;
    }
    // `win-cuda-13.3-x64` → `cudart-llama-bin-win-cuda-13.3-x64.zip`.
    let slug = variant.asset_slug()?;
    Some(format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{TARGET_VERSION}/cudart-llama-bin-{slug}.zip"
    ))
}

/// llama.cpp ships Windows release assets as `.zip` and macOS/Linux assets as
/// `.tar.gz`. Requesting `.zip` for macOS/Linux 404s (the asset doesn't exist),
/// which is why install previously stalled on those platforms while Windows
/// worked.
fn archive_ext() -> &'static str {
    if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    }
}

/// True when the platform release asset is a `.zip` (Windows); `.tar.gz` otherwise.
fn archive_is_zip() -> bool {
    cfg!(target_os = "windows")
}

/// Delete the pre-variant install: `llama-server`/`llama-tts` sitting directly
/// in `~/.ryu/bin`, from before builds were installed per-variant into their own
/// directory. Best-effort — a file we cannot remove is logged, not fatal.
///
/// Only these two names are touched. `~/.ryu/bin` is shared with every other
/// managed binary (whisper-cli, sd-server, tailscale, …), so a directory-wide
/// sweep here would delete other engines' installs.
async fn remove_legacy_install() {
    for stem in ["llama-server", "llama-tts"] {
        let path = ryu_dir().join("bin").join(variant::exe_name(stem));
        if !path.exists() {
            continue;
        }
        match tokio::fs::remove_file(&path).await {
            Ok(()) => tracing::info!("removed pre-variant llama.cpp binary {}", path.display()),
            Err(e) => tracing::warn!("could not remove {}: {e}", path.display()),
        }
    }
}

// ── LlamaCppDownloader ─────────────────────────────────────────────────────────

pub struct LlamaCppDownloader {
    client: reqwest::Client,
    on_progress: Option<ProgressCallback>,
}

impl LlamaCppDownloader {
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

    /// Ensure a llama.cpp build is installed at `~/.ryu/bin/llamacpp/`, picking
    /// the variant for this machine (accelerated when there is a usable GPU,
    /// CPU otherwise) unless the user pinned one.
    ///
    /// The release archive downloads through the global [`DownloadCenter`] (#456)
    /// so it streams to disk and shows in the overlay; we then extract the binary
    /// from the downloaded archive and place it atomically.
    pub async fn ensure_installed(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<()> {
        let wanted = variant::resolve_from_preferences().await;
        self.ensure_variant_installed(downloads, wanted).await
    }

    /// Install `wanted` specifically, replacing whatever variant is on disk.
    ///
    /// Refuses an accelerated variant this node cannot run: an install that
    /// produces a `llama-server` which cannot load its backend is worse than no
    /// install at all, because the failure surfaces as a hung engine start.
    /// Callers that want "whatever works here" go through
    /// [`Self::ensure_installed`], which never asks for an unrunnable variant.
    pub async fn ensure_variant_installed(
        &self,
        downloads: &crate::downloads::DownloadCenter,
        wanted: LlamaVariant,
    ) -> Result<()> {
        let device = variant::device();
        if !wanted.available_on(device) {
            anyhow::bail!(
                "cannot install the {} build of llama.cpp on this node: {}",
                wanted.as_str(),
                wanted
                    .unavailable_reason(device)
                    .unwrap_or("unsupported on this hardware")
            );
        }

        let dest = bin_path();
        let installed = variant::installed_variant();

        // Fast path: the right variant of the right release is already in place.
        // Both terms matter — the version alone would skip a variant SWITCH
        // (the tag does not change when the user moves from CPU to GPU), and the
        // variant alone would skip a Ryu-shipped llama.cpp upgrade.
        let store = VersionStore::load();
        if dest.exists() && installed == Some(wanted) {
            if let Some(stored) = store.versions.get("llamacpp") {
                if stored == TARGET_VERSION {
                    tracing::info!(
                        "llama.cpp {} ({}) already installed — skipping",
                        TARGET_VERSION,
                        wanted.as_str()
                    );
                    return Ok(());
                }
                tracing::warn!(
                    "llama.cpp version mismatch (stored={}, target={}), re-downloading",
                    stored,
                    TARGET_VERSION
                );
            }
        } else if installed.is_some_and(|i| i != wanted) {
            tracing::info!(
                "llama.cpp switching build: {} → {}",
                installed.map(LlamaVariant::as_str).unwrap_or("none"),
                wanted.as_str()
            );
        }

        let url = archive_url(wanted)?;
        tracing::info!("downloading llama.cpp ({}) from {url}", wanted.as_str());

        // Download the archive through the center to a deterministic temp dest
        // (so its own `.part`/resume works), then read it back to extract.
        let archive_dest = ryu_dir().join("tmp").join(format!(
            "llamacpp-{TARGET_VERSION}-{v}.{ext}",
            v = wanted.as_str(),
            ext = archive_ext()
        ));
        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Engine,
                role: crate::downloads::DownloadRole::Engine,
                label: format!("llama.cpp ({})", wanted.label()),
                url,
                dest: archive_dest,
                sha256: None,
                version_record: None,
            })
            .await
            .context("downloading llama.cpp archive")?;
        let archive_data = tokio::fs::read(&archive_path)
            .await
            .context("reading downloaded llama.cpp archive")?;

        // Wipe the previous build before extracting. Backends ship DIFFERENT
        // `ggml-*` shared libraries under the SAME names, and llama.cpp's
        // dynamic backend loader scans the binary's directory — a half-replaced
        // directory is a mixed set that loads and then fails at inference time.
        let bin_dir = variant::install_dir();
        if bin_dir.exists() {
            tokio::fs::remove_dir_all(&bin_dir)
                .await
                .with_context(|| format!("clearing {}", bin_dir.display()))?;
        }
        tokio::fs::create_dir_all(&bin_dir)
            .await
            .with_context(|| format!("creating {}", bin_dir.display()))?;

        // Extract the binary plus its sibling shared libs into the variant dir so
        // the engine's same-dir rpath resolves at launch (blocking I/O on a
        // thread-pool thread).
        let is_zip = archive_is_zip();
        let extract_dir = bin_dir.clone();
        let dest = tokio::task::spawn_blocking(move || {
            extract_binary_with_libs(&archive_data, "llama-server", &extract_dir, is_zip)
        })
        .await
        .context("spawn_blocking for archive extraction")??;

        // The Windows CUDA build needs the CUDA runtime DLLs from a second
        // archive dropped beside it, or it cannot load `ggml-cuda`.
        if let Some(url) = cudart_url(wanted) {
            self.install_cudart(downloads, &url, &bin_dir)
                .await
                .context("installing the CUDA runtime for llama.cpp")?;
        }

        // Set executable bit on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dest, perms)?;
        }

        // Record which build is on disk BEFORE the version row: a crash between
        // the two then leaves "installed, unknown variant", which reinstalls,
        // rather than "right version, wrong backend", which would not.
        variant::record_installed(wanted).context("recording the installed llama.cpp variant")?;

        // Record version atomically — never clobbers a concurrently-installed engine.
        VersionStore::set_version_persisted("llamacpp", TARGET_VERSION)
            .context("writing versions.json")?;

        // The extracted binary is in place; drop the temp archive.
        let _ = tokio::fs::remove_file(&archive_path).await;

        // Retire the pre-variant install (a `llama-server` loose in ~/.ryu/bin).
        // Left in place it is a second, stale copy that every path-probing
        // caller could still find.
        remove_legacy_install().await;

        // Ensure PATH includes ~/.ryu/bin
        if let Err(e) = crate::sidecar::path_manager::PathManager::add_to_path() {
            tracing::warn!("Failed to add ~/.ryu/bin to PATH: {}", e);
        }

        tracing::info!(
            "llama.cpp {} ({}) installed at {}",
            TARGET_VERSION,
            wanted.as_str(),
            dest.display()
        );
        Ok(())
    }

    /// Download the CUDA runtime archive and unpack its DLLs beside the engine.
    /// Unlike the engine archive this has no single "wanted binary" — it is a
    /// bag of runtime libraries — so it extracts every file at its leaf name.
    async fn install_cudart(
        &self,
        downloads: &crate::downloads::DownloadCenter,
        url: &str,
        bin_dir: &std::path::Path,
    ) -> Result<()> {
        let dest = ryu_dir()
            .join("tmp")
            .join(format!("llamacpp-cudart-{TARGET_VERSION}.zip"));
        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Engine,
                role: crate::downloads::DownloadRole::Engine,
                label: "CUDA runtime".to_string(),
                url: url.to_string(),
                dest,
                sha256: None,
                version_record: None,
            })
            .await
            .context("downloading the CUDA runtime archive")?;
        let data = tokio::fs::read(&archive_path)
            .await
            .context("reading the downloaded CUDA runtime archive")?;
        let bin_dir = bin_dir.to_path_buf();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data))
                .context("opening the CUDA runtime archive")?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                if entry.is_dir() {
                    continue;
                }
                let Some(name) = entry
                    .enclosed_name()
                    .and_then(|p| p.file_name().map(|f| f.to_os_string()))
                else {
                    continue;
                };
                // Runtime libraries only. The archive should contain nothing
                // else, but it is a remote zip being unpacked next to an
                // executable — extract by allowlist, not by whatever it names.
                if !name
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".dll")
                {
                    continue;
                }
                let mut out = std::fs::File::create(bin_dir.join(name))?;
                std::io::copy(&mut entry, &mut out)?;
            }
            Ok(())
        })
        .await
        .context("spawn_blocking for CUDA runtime extraction")??;
        let _ = tokio::fs::remove_file(&archive_path).await;
        Ok(())
    }

    /// Ensure the `llama-tts` text-to-speech binary is installed beside the
    /// engine in `~/.ryu/bin/llamacpp/`. Shares the same llama.cpp release
    /// archive as `llama-server`; used by the OuteTTS voice engine. Idempotent:
    /// skips the download when the binary already exists.
    ///
    /// Pulls the archive for the variant that is *installed*, so `llama-tts`
    /// and `llama-server` always come from one build and share one set of
    /// `ggml-*` libraries.
    pub async fn ensure_tts_binary(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<PathBuf> {
        let dest = variant::tts_path();
        if dest.exists() {
            return Ok(dest);
        }

        let wanted = match variant::installed_variant() {
            Some(v) => v,
            None => variant::resolve_from_preferences().await,
        };
        let url = archive_url(wanted)?;
        tracing::info!("downloading llama.cpp (for llama-tts) from {url}");
        // Download the archive through the center (shows in the overlay), then
        // extract llama-tts. Shares the llama-server release archive.
        let archive_dest = ryu_dir().join("tmp").join(format!(
            "llamacpp-tts-{TARGET_VERSION}-{v}.{ext}",
            v = wanted.as_str(),
            ext = archive_ext()
        ));
        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Voice,
                role: crate::downloads::DownloadRole::Engine,
                label: "llama-tts".to_string(),
                url,
                dest: archive_dest,
                sha256: None,
                version_record: None,
            })
            .await
            .context("downloading llama.cpp archive for llama-tts")?;
        let archive_data = tokio::fs::read(&archive_path)
            .await
            .context("reading downloaded llama-tts archive")?;

        // Extract llama-tts plus its sibling shared libs (shared with
        // llama-server) into the variant dir so its same-dir rpath resolves.
        let bin_dir = variant::install_dir();
        tokio::fs::create_dir_all(&bin_dir)
            .await
            .with_context(|| format!("creating {}", bin_dir.display()))?;
        let is_zip = archive_is_zip();
        let dest = tokio::task::spawn_blocking(move || {
            extract_binary_with_libs(&archive_data, "llama-tts", &bin_dir, is_zip)
        })
        .await
        .context("spawn_blocking for archive extraction")??;
        let _ = tokio::fs::remove_file(&archive_path).await;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dest, perms)?;
        }

        tracing::info!("llama-tts installed at {}", dest.display());
        Ok(dest)
    }
}

impl Default for LlamaCppDownloader {
    fn default() -> Self {
        Self::new()
    }
}
