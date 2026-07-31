//! Shadow binary downloader.
//!
//! It downloads a pre-built archive and extracts `shadow[.exe]` from it. Where
//! that archive comes from is the whole subtlety. The default is the hub release
//! (`amajorai/ryu`), which `.github/workflows/release.yml` now stages a
//! `shadow-<os>-<arch>.tar.gz|.zip` into; `RYU_SHADOW_RELEASE_URL` overrides it
//! with a private, pre-release or self-built archive. The "Release URL" section
//! below spells out all three sources, including the one that is not a download.

use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::sidecar::download_manager::{
    build_http_client, compute_sha256, extract_from_tar_gz, extract_from_zip, ryu_dir,
    ProgressCallback, VersionStore,
};

// ── Paths ──────────────────────────────────────────────────────────────────────

fn bin_path() -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "shadow.exe"
    } else {
        "shadow"
    };
    ryu_dir().join("bin").join(name)
}

// ── Release URL ────────────────────────────────────────────────────────────────
//
// WHERE THE SHADOW BINARY ON A USER MACHINE COMES FROM. Identical in shape to
// Ghost's — see `sidecar/tools/ghost/downloader.rs` for the long form.
//
// 1. Built from source. `github.com/amajorai/shadow` is a real, public repo: the
//    read-only satellite mirror that `tools/mirror-satellites.sh` (`legacy`
//    group) generates from `apps/shadow` + `crates/ghost/{shadow,core,eyes,
//    hands,permissions}` via `tools/mirror-satellite.sh`. It carries the source
//    with a complete, mirror-time-guarded Cargo path-dep closure (that guard is
//    why: the published tree omitted `crates/ghost/permissions` and
//    `cargo metadata` died in it). It deliberately ships NO release workflow:
//    Shadow is a monorepo workspace member on the single release train, so its
//    binary is published by the train, not by the satellite. That split is
//    documented at the top of `tools/mirror-satellite.sh`.
//
// 2. The hub release — `github.com/amajorai/ryu/releases` — THE DEFAULT, same
//    place `ryu-core-<os>-<arch>` and every `apps-store` sidecar bin come from.
//    The `binaries` job in `.github/workflows/release.yml` builds `-p ghost -p
//    shadow` alongside the sidecar bins and stages `shadow-<suffix>.<gsext>`
//    (`tar.gz`, or `zip` on Windows) plus a sibling `.sha256`, which
//    `ensure_installed` now verifies the downloaded archive against.
//
//    That workflow is in the PRIVATE repo and is the authoritative producer;
//    `mirror-releases.yml` copies the whole asset set to the public hub this URL
//    points at. The public repo's own `mirror/overlay/.github/workflows/release.yml`
//    is a different pipeline (core/gateway/cli only) — the mirror ships
//    `crates/ghost` but not `apps/shadow`, so it cannot build this asset.
//
//    Honest scope: the workflow *stages* these assets as of this change — no
//    pipeline run has been observed producing them. The matrix has three legs
//    (`linux-x86_64`, `macos-aarch64`, `windows-x86_64`) and no Intel-macOS one,
//    the same pre-existing gap that leaves `ryu-core-macos-x86_64` unpublished; on
//    such a host the synthesized URL points at an asset that does not exist. That
//    is diagnosed in `ensure_installed`'s download failure rather than by
//    refusing to look — see the long form in Ghost's module.
//
//    `releases/latest/download` rather than a pinned tag, mirroring
//    `manifest_sidecar`: an older Core pulls the newest Shadow.
//
// 3. `RYU_SHADOW_RELEASE_URL` — the override. A FULL per-platform URL, not a base
//    directory (unlike `RYU_SIDECAR_RELEASE_BASE`). What it is FOR is pointing
//    this downloader at a private, pre-release, self-hosted or locally-built
//    archive — including on a platform the matrix does not cover. The comment
//    that used to sit here claimed there was "no public Shadow release repo yet,
//    so this is the only way"; the repo exists, and it is not where the artifact
//    is meant to come from.

/// Env knob carrying the FULL per-platform Shadow release archive URL (not a base
/// directory — see source 3 above). Overrides the hub default; see [`archive_url`]
/// for the unset case.
const SHADOW_RELEASE_URL_ENV: &str = "RYU_SHADOW_RELEASE_URL";

/// The release asset this host needs — `shadow-<os>-<arch>.<ext>`. Both the last
/// path segment of the hub URL [`archive_url`] synthesizes and the name quoted in
/// `ensure_installed`'s download failure, so an operator knows exactly what
/// `RYU_SHADOW_RELEASE_URL` must point at and what CI must publish.
///
/// The `<os>-<arch>` slug is [`crate::update::platform_tag`], byte-identical to
/// the suffix every headless asset is staged under in `.github/workflows/
/// release.yml` (`linux-x86_64` / `macos-aarch64` / `windows-x86_64`). Derived
/// rather than tabulated: the `cfg`-table that used to live here emitted
/// `macos-arm64` / `linux-x64` / `windows-x64`, a naming convention nothing in
/// this repo publishes.
///
/// The extension is load-bearing: `ensure_installed` downloads an ARCHIVE and
/// extracts `shadow[.exe]` from it, so the publisher must ship an archive, not a
/// bare binary like `ryu-core-macos-aarch64`.
fn artifact_name() -> String {
    let ext = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    format!("shadow-{}.{ext}", crate::update::platform_tag())
}

/// Resolve the release archive URL for this platform: [`SHADOW_RELEASE_URL_ENV`]
/// verbatim when set and non-blank, otherwise the hub release asset.
///
/// **Infallible on purpose** — a behaviour change. This used to return `Err` when
/// the env was unset, because the release train published no Shadow asset and a
/// synthesized URL would have 404'd. The train now stages one (source 2 above), so
/// refusing would leave a published artifact permanently unreachable. The
/// remaining unpublished-platform case is diagnosed where the 404 surfaces, in
/// [`ShadowDownloader::ensure_installed`].
fn archive_url() -> String {
    if let Ok(url) = std::env::var(SHADOW_RELEASE_URL_ENV) {
        let url = url.trim();
        if !url.is_empty() {
            return url.to_owned();
        }
    }
    // Same shape and same `RYU_REPO` as
    // `manifest_sidecar::ensure_local_sidecar_present`'s default. Built from
    // `artifact_name()` so the URL cannot carry a platform slug the release
    // workflow does not stage assets under.
    format!(
        "https://github.com/{}/releases/latest/download/{}",
        crate::update::RYU_REPO,
        artifact_name()
    )
}

// ── Archive integrity: the sibling `.sha256` ───────────────────────────────────
//
// Byte-for-byte the same reasoning as Ghost's — see the long form in
// `sidecar/tools/ghost/downloader.rs`, which also carries the "hoist into
// `download_manager` when that file is next opened" note. In short: the release
// workflow emits a `<asset>.sha256` next to every staged asset, `ensure_installed`
// used to pass `sha256: None` and execute whatever bytes came back, and a
// published digest nothing verifies against is a shipped artifact that cannot
// take effect. Precedent is `manifest_sidecar::fetch_release_sha256` (duplicated,
// not called: that one is `#[cfg(not(debug_assertions))]` and its `screen_https`
// is module-private). NOT a precedent: the llama.cpp downloader, which passes
// `sha256: None` at both call sites.
//
// Best-effort rather than fail-closed, unlike `mirror/overlay/install.sh`:
// `RYU_SHADOW_RELEASE_URL` exists to point at self-built archives that have no
// sibling digest, and failing closed would make the documented override unusable.

/// The sibling checksum URL for a release archive.
fn sha256_url(archive_url: &str) -> String {
    format!("{archive_url}.sha256")
}

/// Parse a published `.sha256` body into a lowercase 64-char hex digest.
///
/// Accepts the two-column `<hex>  <filename>` form both `sha256sum` and
/// `shasum -a 256` write, and a bare hex line. Anything that is not exactly 64 hex
/// characters is rejected rather than passed on, because `DownloadCenter` compares
/// the value verbatim: a truncated or HTML-error-page "digest" would fail the
/// transfer as a checksum mismatch and misdiagnose a missing file as a corrupt one.
///
/// Pure so it is testable against the real published format without a network
/// call; the fetch wrapper is [`ShadowDownloader::fetch_release_sha256`].
fn parse_sha256_digest(body: &str) -> Option<String> {
    let hex = body.split_whitespace().next()?;
    if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(hex.to_ascii_lowercase())
    } else {
        None
    }
}

// ── ShadowDownloader ───────────────────────────────────────────────────────────

pub struct ShadowDownloader {
    client: reqwest::Client,
    on_progress: Option<ProgressCallback>,
}

impl ShadowDownloader {
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

    /// Best-effort fetch of the archive's sibling `<url>.sha256`, for
    /// [`crate::downloads::DownloadSpec::sha256`] to verify the downloaded bytes
    /// against. `None` when the checksum is absent, unreachable or malformed.
    ///
    /// Only `https` URLs are followed: `RYU_SHADOW_RELEASE_URL` is arbitrary
    /// operator input, and a plaintext checksum fetched over `http` is rewritable
    /// by whoever rewrote the archive, so following it would be verification
    /// theatre. A non-https override downloads unverified (warned) instead.
    async fn fetch_release_sha256(&self, archive_url: &str) -> Option<String> {
        if !archive_url.starts_with("https://") {
            return None;
        }
        let body = self
            .client
            .get(sha256_url(archive_url))
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .text()
            .await
            .ok()?;
        parse_sha256_digest(&body)
    }

    /// Ensure the Shadow binary is installed at `~/.ryu/bin/shadow`.
    ///
    /// The release archive downloads through the global [`DownloadCenter`] (#456)
    /// so it streams to disk and shows in the overlay; we then extract the binary
    /// from the downloaded archive and place it atomically.
    pub async fn ensure_installed(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<()> {
        let dest = bin_path();

        // Fast path: already installed with a matching checksum.
        let store = VersionStore::load();
        if dest.exists() {
            if let Some(stored) = store.installed_checksum("shadow") {
                let actual = compute_sha256(&dest).await?;
                if actual == stored {
                    tracing::info!("shadow already installed and checksum valid — skipping");
                    return Ok(());
                }
                tracing::warn!(
                    "shadow checksum mismatch (stored={stored} actual={actual}), re-downloading"
                );
            }
        }

        let url = archive_url();
        tracing::info!("downloading shadow binary from {url}");

        // Download the archive through the center to a deterministic temp dest
        // (so its own `.part`/resume works), then read it back to extract.
        let archive_ext = if cfg!(target_os = "windows") {
            "zip"
        } else {
            "tar.gz"
        };
        let archive_dest = ryu_dir().join("tmp").join(format!("shadow.{archive_ext}"));

        // Integrity: verify the ARCHIVE against the sibling `.sha256` the release
        // publishes. Scope matters — this digest covers the downloaded archive
        // (`DownloadSpec::dest`), NOT the `shadow` binary extracted from it, which
        // is hashed separately below and recorded in `versions.json` under the
        // `shadow` key. Two different values over two different byte ranges;
        // crossing them would invert the fast path.
        let sha256 = self.fetch_release_sha256(&url).await;
        if sha256.is_none() {
            tracing::warn!(
                "shadow: no usable .sha256 published at {} — downloading unverified",
                sha256_url(&url)
            );
        }

        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Tool,
                label: "Shadow".to_string(),
                url: url.to_string(),
                dest: archive_dest,
                sha256,
                version_record: None,
            })
            .await
            // The 404 case is the one worth naming: on a platform the `binaries`
            // matrix does not cover (Intel macOS today) the hub URL points at an
            // asset that was never staged, and the transfer engine reports that as a
            // bare `HTTP 404 Not Found for <url>` — indistinguishable from a broken
            // download. State the likelier cause and the remedy where it surfaces.
            .with_context(|| {
                format!(
                    "downloading shadow archive from {url}. If this is a 404, this Ryu \
                     release publishes no `{}` — set {SHADOW_RELEASE_URL_ENV} to a \
                     self-built or pre-release archive for this platform, or build \
                     shadow from source (apps/shadow in the monorepo, or its public \
                     mirror github.com/amajorai/shadow)",
                    artifact_name()
                )
            })?;
        let archive_data = tokio::fs::read(&archive_path)
            .await
            .context("reading downloaded shadow archive")?;

        // Extract binary from the archive (blocking I/O on a thread-pool thread).
        let binary_name = if cfg!(target_os = "windows") {
            "shadow.exe"
        } else {
            "shadow"
        };
        let extracted = tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                extract_from_zip(&archive_data, binary_name)
            }
            #[cfg(not(target_os = "windows"))]
            {
                extract_from_tar_gz(&archive_data, binary_name)
            }
        })
        .await
        .context("spawn_blocking for archive extraction")??;

        // Write extracted binary atomically.
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let atomic_tmp = dest.with_extension("tmp");
        tokio::fs::write(&atomic_tmp, &extracted)
            .await
            .with_context(|| format!("writing {}", atomic_tmp.display()))?;
        tokio::fs::rename(&atomic_tmp, &dest)
            .await
            .with_context(|| format!("rename {} → {}", atomic_tmp.display(), dest.display()))?;

        // Set executable bit on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dest, perms)?;
        }

        // Compute checksum from in-memory bytes (avoids re-reading from disk).
        let checksum = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&extracted);
            hex::encode(hasher.finalize())
        };
        let version = "latest"; // TODO: Get actual version from binary
        VersionStore::record_persisted("shadow", version, &checksum)
            .context("writing versions.json")?;

        // The extracted binary is in place; drop the temp archive.
        let _ = tokio::fs::remove_file(&archive_path).await;

        // Ensure PATH includes ~/.ryu/bin
        if let Err(e) = crate::sidecar::path_manager::PathManager::add_to_path() {
            tracing::warn!("Failed to add ~/.ryu/bin to PATH: {}", e);
        }

        tracing::info!("shadow installed at {}", dest.display());
        Ok(())
    }
}

impl Default for ShadowDownloader {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `std::env::set_var` is process-global: these tests must not interleave with
    // each other. Mirrors the guard in the Ghost downloader's tests.
    static SHADOW_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        SHADOW_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    struct EnvGuard {
        prev: Option<String>,
    }
    impl EnvGuard {
        fn set(val: &str) -> Self {
            let prev = std::env::var(SHADOW_RELEASE_URL_ENV).ok();
            std::env::set_var(SHADOW_RELEASE_URL_ENV, val);
            Self { prev }
        }
        fn clear() -> Self {
            let prev = std::env::var(SHADOW_RELEASE_URL_ENV).ok();
            std::env::remove_var(SHADOW_RELEASE_URL_ENV);
            Self { prev }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(SHADOW_RELEASE_URL_ENV, v),
                None => std::env::remove_var(SHADOW_RELEASE_URL_ENV),
            }
        }
    }

    #[test]
    fn bin_path_is_under_the_ryu_bin_dir() {
        let p = bin_path();
        assert_eq!(p.parent().and_then(|d| d.file_name()), Some("bin".as_ref()));
        assert!(
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("shadow")),
            "got: {}",
            p.display()
        );
    }

    #[test]
    fn artifact_name_uses_the_release_trains_platform_slug() {
        // Derived, not tabulated, so it cannot drift from the slug the release
        // workflow stages assets under — the drift that left `macos-arm64` here
        // next to a train publishing `macos-aarch64`.
        let name = artifact_name();
        assert!(name.starts_with("shadow-"), "got: {name}");
        assert!(
            name.contains(&crate::update::platform_tag()),
            "artifact name {name} must carry the release train's platform slug {}",
            crate::update::platform_tag()
        );
        // An ARCHIVE, because `ensure_installed` extracts a binary out of it.
        let ext = if cfg!(target_os = "windows") {
            ".zip"
        } else {
            ".tar.gz"
        };
        assert!(name.ends_with(ext), "got: {name}");
    }

    #[test]
    fn archive_url_defaults_to_the_hub_release_asset() {
        // The inverse of the assertion it replaces. The release train now stages
        // `shadow-<platform_tag>.<ext>`, so an unset env must resolve to that
        // asset — refusing is what kept a published artifact unreachable.
        let _lock = lock_env();
        let _g = EnvGuard::clear();
        let url = archive_url();
        assert_eq!(
            url,
            format!(
                "https://github.com/{}/releases/latest/download/{}",
                crate::update::RYU_REPO,
                artifact_name()
            ),
            "got: {url}"
        );
        assert!(url.ends_with(&artifact_name()), "got: {url}");
        // `latest`, not a pinned tag — mirrors `manifest_sidecar`. See source 2.
        assert!(url.contains("/releases/latest/download/"), "got: {url}");
    }

    #[test]
    fn archive_url_uses_env_override_trimmed() {
        // The override still wins over the new default, and is used VERBATIM: it
        // carries a full URL, not a base to append `artifact_name()` to.
        let _lock = lock_env();
        let _g = EnvGuard::set("  https://mirror.test/shadow.tar.gz  ");
        assert_eq!(archive_url(), "https://mirror.test/shadow.tar.gz");
    }

    #[test]
    fn archive_url_blank_env_falls_back_to_the_hub_default() {
        // A knob set to whitespace is "unset", not "an empty URL" — otherwise
        // `RYU_SHADOW_RELEASE_URL=` in an env file would make Shadow undownloadable.
        let _lock = lock_env();
        let _g = EnvGuard::set("   ");
        assert!(archive_url().starts_with("https://github.com/"));
        assert!(archive_url().ends_with(&artifact_name()));
    }

    // ── sibling `.sha256` ─────────────────────────────────────────────────────
    //
    // Pure half only, deliberately: a test doing a live GET against the hub is
    // green whenever GitHub is up and says nothing about whether we can parse what
    // the release actually publishes.

    #[test]
    fn sha256_url_is_the_published_asset_plus_the_suffix() {
        // The workflow emits `<asset>.sha256` — an exact sibling, not a separate
        // SHASUMS manifest. Drift here silently downgrades every download to
        // unverified, so pin it against the URL we really request.
        let _lock = lock_env();
        let _g = EnvGuard::clear();
        let url = archive_url();
        assert_eq!(sha256_url(&url), format!("{url}.sha256"));
        assert!(sha256_url(&url).ends_with(".tar.gz.sha256") || cfg!(target_os = "windows"));
    }

    #[test]
    fn parse_sha256_digest_reads_the_two_column_shasum_form() {
        // The exact bytes `sha256sum` / `shasum -a 256` write, which is what
        // `.github/workflows/release.yml` and `scripts/release/release-local.sh`
        // redirect into the `.sha256` file.
        let hex = "b".repeat(64);
        assert_eq!(
            parse_sha256_digest(&format!("{hex}  shadow-macos-aarch64.tar.gz\n")),
            Some(hex.clone())
        );
        assert_eq!(
            parse_sha256_digest(&format!("{hex} shadow.tar.gz")),
            Some(hex.clone())
        );
        assert_eq!(parse_sha256_digest(&hex), Some(hex.clone()));
        assert_eq!(parse_sha256_digest(&format!("  \n {hex}\n")), Some(hex));
    }

    #[test]
    fn parse_sha256_digest_lowercases() {
        // `DownloadCenter` compares against `hex::encode`'s lowercase output, so an
        // uppercase digest would fail every transfer as a "checksum mismatch" — a
        // corrupt-download diagnosis for a perfectly good file.
        let upper = "A1B2C3D4".repeat(8);
        assert_eq!(upper.len(), 64);
        assert_eq!(parse_sha256_digest(&upper), Some("a1b2c3d4".repeat(8)));
    }

    #[test]
    fn parse_sha256_digest_rejects_anything_that_is_not_a_digest() {
        // Rejection matters more than acceptance: `None` downloads unverified with
        // a warning, whereas a bogus non-digest aborts the transfer and blames the
        // archive. GitHub answers a missing asset with an HTML page.
        assert_eq!(parse_sha256_digest(""), None);
        assert_eq!(parse_sha256_digest("   \n\t "), None);
        assert_eq!(parse_sha256_digest("<!DOCTYPE html><html>Not Found"), None);
        assert_eq!(parse_sha256_digest(&"b".repeat(63)), None, "too short");
        assert_eq!(parse_sha256_digest(&"b".repeat(65)), None, "too long");
        assert_eq!(parse_sha256_digest(&"g".repeat(64)), None, "not hex");
        assert_eq!(parse_sha256_digest("sha256 shadow.tar.gz"), None);
    }

    #[tokio::test]
    async fn fetch_release_sha256_refuses_non_https_urls() {
        // `RYU_SHADOW_RELEASE_URL` is operator input. Over plaintext the checksum is
        // rewritable by whoever rewrote the archive, so decline rather than perform
        // verification theatre — the caller then warns and downloads unverified,
        // which is at least honest. No network is touched: the scheme check returns
        // before a request is built.
        let d = ShadowDownloader::new();
        assert_eq!(
            d.fetch_release_sha256("http://mirror.test/s.tar.gz").await,
            None
        );
        assert_eq!(
            d.fetch_release_sha256("file:///tmp/shadow.tar.gz").await,
            None
        );
        assert_eq!(d.fetch_release_sha256("/tmp/shadow.tar.gz").await, None);
    }
}
