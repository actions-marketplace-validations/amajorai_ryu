//! Ghost binary downloader.
//!
//! It downloads a pre-built archive and extracts `ghost[.exe]` from it. Where
//! that archive comes from is the whole subtlety. The default is the hub release
//! (`amajorai/ryu`), which `.github/workflows/release.yml` now stages a
//! `ghost-<os>-<arch>.tar.gz|.zip` into; `RYU_GHOST_RELEASE_URL` overrides it with
//! a private, pre-release or self-built archive. The "Release URL" section below
//! spells out all three sources, including the one that is not a download at all.

use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::sidecar::download_manager::{
    build_http_client, compute_sha256, extract_from_tar_gz, extract_from_zip, ryu_dir,
    ProgressCallback, VersionStore,
};

// ── Paths ──────────────────────────────────────────────────────────────────────

fn bin_path() -> PathBuf {
    super::ghost_bin_path()
}

// ── Release URL ────────────────────────────────────────────────────────────────
//
// WHERE THE GHOST BINARY ON A USER MACHINE COMES FROM.
//
// 1. Built from source. `github.com/amajorai/ghost` is a real, public repo: the
//    read-only satellite mirror that `tools/mirror-satellites.sh` (`legacy`
//    group) generates from `apps/ghost` + `crates/ghost/*` via
//    `tools/mirror-satellite.sh`. It carries the source, and its Cargo path-dep
//    closure is complete and guarded at mirror time (that guard is why: the
//    published tree omitted `crates/ghost/permissions` and `cargo metadata`
//    died in it). What it deliberately does NOT carry is a release workflow —
//    Ghost is a monorepo workspace member on the single release train (this
//    crate and `apps/ghost` are both versioned together), so its binary is
//    published by the train, not by the satellite. `tools/mirror-satellite.sh`
//    documents that split; `docs/RELEASING.md` §8 covers the satellites that DO
//    release their own artifacts (the self-contained `apps-store/*` apps).
//
// 2. The hub release — `github.com/amajorai/ryu/releases` — which is where
//    `ryu-core-<os>-<arch>` and every `apps-store` sidecar bin already come from
//    (`manifest_sidecar::ensure_local_sidecar_present`, whose own doc calls this
//    module's env knob the seam it mirrors). THIS IS THE DEFAULT, as of the same
//    change that added the asset: the `binaries` job in
//    `.github/workflows/release.yml` builds `-p ghost -p shadow` alongside the
//    sidecar bins and stages `ghost-<suffix>.<gsext>` (`tar.gz`, or `zip` on
//    Windows) plus a sibling `.sha256`, which `ensure_installed` now verifies the
//    downloaded archive against — see the integrity section below.
//
//    That workflow lives in the PRIVATE repo and is the authoritative producer;
//    `mirror-releases.yml` copies the whole asset set to the public hub this URL
//    points at. The public repo's own `mirror/overlay/.github/workflows/release.yml`
//    is a different pipeline that builds core/gateway/cli ONLY — the mirror ships
//    `crates/ghost` but not `apps/ghost`, so it cannot build this asset. A `v*` tag
//    pushed directly to the public repo therefore yields a release with no Ghost
//    archive; both workflow headers say so.
//
//    Honest scope of that claim: the workflow *stages* these assets as of this
//    change — no pipeline run has been observed producing them. And the
//    `binaries` matrix has three legs (`linux-x86_64`, `macos-aarch64`,
//    `windows-x86_64`) and no Intel-macOS one, the same pre-existing gap that
//    leaves `ryu-core-macos-x86_64` unpublished. On such a host the synthesized
//    URL resolves to an asset that does not exist, so `ensure_installed` names
//    that possibility (and the remedy) in the download failure rather than
//    letting a bare `HTTP 404` stand as the diagnosis. That is the concession to
//    the reasoning that used to keep `archive_url` refusing outright: a 404 is a
//    worse diagnosis than "this release ships no Ghost for your platform", so we
//    say the latter where the 404 is caught.
//
//    `releases/latest/download` — not a pinned tag — deliberately, mirroring
//    `manifest_sidecar`: an older Core pulls the newest Ghost. Ghost is on the
//    single release train, so the two are normally the same version anyway.
//
// 3. `RYU_GHOST_RELEASE_URL` — the override. It carries a FULL per-platform URL,
//    NOT a base directory: do not conflate it with `RYU_SIDECAR_RELEASE_BASE`,
//    which is a base that `manifest_sidecar` appends an asset name to. What it is
//    FOR is pointing this downloader at a private, pre-release, self-hosted or
//    locally-built archive instead of the hub artifact — including on a platform
//    the matrix above does not cover. The comment that used to sit here said
//    there was "no public Ghost release repo yet, so this is the only way": wrong
//    on both counts once the satellite existed — the repo does exist, and it is
//    not where the artifact is meant to come from.

/// Env knob carrying the FULL per-platform Ghost release archive URL (not a base
/// directory — see source 3 above). Overrides the hub default; see [`archive_url`]
/// for the unset case.
const GHOST_RELEASE_URL_ENV: &str = "RYU_GHOST_RELEASE_URL";

/// The release asset this host needs — `ghost-<os>-<arch>.<ext>`. It is both the
/// last path segment of the hub URL [`archive_url`] synthesizes and the name quoted
/// in `ensure_installed`'s download failure, so an operator knows exactly what
/// `RYU_GHOST_RELEASE_URL` must point at and what CI must publish.
///
/// The `<os>-<arch>` slug is [`crate::update::platform_tag`], byte-identical to
/// the suffix every headless asset is staged under in `.github/workflows/
/// release.yml` (`linux-x86_64` / `macos-aarch64` / `windows-x86_64`) and to the
/// one `manifest_sidecar` expects of an app sidecar bin. It is DERIVED rather
/// than tabulated because the `cfg`-table that used to live here emitted
/// `macos-arm64` / `linux-x64` / `windows-x64` — a fourth naming convention,
/// matching nothing this repo publishes, pointing every operator who read the
/// error at an asset that could never exist under that name.
///
/// The extension is load-bearing, not decoration: `ensure_installed` downloads
/// an ARCHIVE and extracts `ghost[.exe]` from it, so whatever publishes this
/// asset must publish an archive, not a bare binary like `ryu-core-macos-aarch64`.
fn artifact_name() -> String {
    let ext = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    format!("ghost-{}.{ext}", crate::update::platform_tag())
}

/// Resolve the release archive URL for this platform: [`GHOST_RELEASE_URL_ENV`]
/// verbatim when set and non-blank, otherwise the hub release asset.
///
/// **Infallible on purpose**, and that is a behaviour change worth being explicit
/// about. This used to return `Err` when the env was unset, because the release
/// train published no Ghost asset and a synthesized URL would have 404'd. The
/// train now stages one (see source 2 above), so refusing would leave a published
/// artifact permanently unreachable — a shipped asset that nothing can consume,
/// which is the same class of defect as an unreachable setting. The remaining
/// unpublished-platform case is diagnosed where the 404 actually surfaces, in
/// [`GhostDownloader::ensure_installed`], not by declining to look.
fn archive_url() -> String {
    if let Ok(url) = std::env::var(GHOST_RELEASE_URL_ENV) {
        let url = url.trim();
        if !url.is_empty() {
            return url.to_owned();
        }
    }
    // Same shape as `manifest_sidecar::ensure_local_sidecar_present`'s default, and
    // the same `RYU_REPO`. Built from `artifact_name()` so the URL cannot carry a
    // platform slug the release workflow does not stage assets under.
    format!(
        "https://github.com/{}/releases/latest/download/{}",
        crate::update::RYU_REPO,
        artifact_name()
    )
}

// ── Archive integrity: the sibling `.sha256` ───────────────────────────────────
//
// The release workflow's staging step (`.github/workflows/release.yml`, the
// `for f in *` loop over `dist/`) emits a `<asset>.sha256` next to EVERY staged
// asset, including `ghost-<os>-<arch>.tar.gz|.zip`, and `mirror-releases.yml`
// copies the whole asset set to the public hub. Until this change nothing on the
// Core side read it: `ensure_installed` passed `sha256: None` and executed
// whatever bytes came back. A published digest that no consumer verifies against
// is a shipped artifact that cannot take effect — the same defect class as an
// unreachable setting — and this is a binary Ryu then *runs*.
//
// PRECEDENT: `sidecar/manifest_sidecar.rs::fetch_release_sha256`, which does
// exactly this for the apps-store sidecar bins off the same release. This is a
// deliberate duplicate of that helper rather than a call to it, for two reasons
// that are both about the seam, not about taste:
//   - that one is `#[cfg(not(debug_assertions))]` (the download it guards is
//     release-only; ghost's is not, so a dev build must still verify), and
//   - its `screen_https` SSRF screen is private to that module.
// NOT a precedent: `sidecar/providers/llamacpp/downloader.rs`, which passes
// `sha256: None` at both of its call sites — it verifies nothing either.
// When `sidecar/download_manager.rs` is next opened, hoist this pair (here and
// the byte-identical copy in `sidecar/tools/shadow/downloader.rs`) into it and
// make `manifest_sidecar` call the same function.
//
// BEST-EFFORT, NOT FAIL-CLOSED, and the asymmetry with `mirror/overlay/install.sh`
// (which aborts on a missing checksum) is deliberate rather than an oversight.
// That installer only ever fetches hub assets, so an absent `.sha256` there means
// something is wrong. Here the URL may come from `RYU_GHOST_RELEASE_URL`, whose
// documented purpose is a self-built or pre-release archive that has no sibling
// digest at all; failing closed would make the documented override unusable.
// Matching `manifest_sidecar`'s warn-and-continue keeps the knob working. The
// warning says "downloading unverified" in as many words — it must never read as
// though verification happened.

/// The sibling checksum URL for a release archive.
fn sha256_url(archive_url: &str) -> String {
    format!("{archive_url}.sha256")
}

/// Parse a published `.sha256` body into a lowercase 64-char hex digest.
///
/// Both `sha256sum` and `shasum -a 256` write the two-column `<hex>  <filename>`
/// form, which is what the release workflow and `scripts/release/release-local.sh`
/// produce; a bare hex line is accepted too because hand-made mirrors emit it.
/// Anything that is not exactly 64 hex characters is rejected rather than passed
/// on, because `DownloadCenter` compares the value verbatim — a truncated or
/// HTML-error-page "digest" would fail every transfer with a checksum mismatch
/// and misdiagnose a missing file as a corrupt download.
///
/// Pure so it can be tested against the real published format without a network
/// call; the fetch wrapper around it is [`GhostDownloader::fetch_release_sha256`].
fn parse_sha256_digest(body: &str) -> Option<String> {
    let hex = body.split_whitespace().next()?;
    if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(hex.to_ascii_lowercase())
    } else {
        None
    }
}

// ── GhostDownloader ────────────────────────────────────────────────────────────

pub struct GhostDownloader {
    client: reqwest::Client,
    on_progress: Option<ProgressCallback>,
}

impl GhostDownloader {
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
    /// against. `None` when the checksum is absent, unreachable or malformed — see
    /// the BEST-EFFORT paragraph in the section comment above for why that is not
    /// an error here even though the shell installers treat it as one.
    ///
    /// Only `https` URLs are followed. `RYU_GHOST_RELEASE_URL` is arbitrary
    /// operator input, and a plaintext checksum fetched over `http` could be
    /// rewritten by whoever rewrote the archive, so it would be verification
    /// theatre rather than verification. A non-https override therefore downloads
    /// unverified (warned) instead of pretending.
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

    /// Ensure the Ghost binary is installed at `~/.ryu/bin/ghost`.
    ///
    /// The GitHub release archive downloads through the global
    /// [`DownloadCenter`] (#456) so it streams to disk and shows in the overlay;
    /// we then extract the binary from the downloaded archive and place it
    /// atomically.
    pub async fn ensure_installed(
        &self,
        downloads: &crate::downloads::DownloadCenter,
    ) -> Result<()> {
        let dest = bin_path();

        // Fast path: already installed with a matching checksum.
        let store = VersionStore::load();
        if dest.exists() {
            if let Some(stored) = store.installed_checksum("ghost") {
                let actual = compute_sha256(&dest).await?;
                if actual == stored {
                    tracing::info!("ghost already installed and checksum valid — skipping");
                    return Ok(());
                }
                tracing::warn!(
                    "ghost checksum mismatch (stored={stored} actual={actual}), re-downloading"
                );
            }
        }

        let url = archive_url();
        tracing::info!("downloading ghost binary from {url}");

        // Download the archive through the center to a deterministic temp dest
        // (so its own `.part`/resume works), then read it back to extract. The
        // archive extension matches the platform's release artifact.
        let archive_ext = if cfg!(target_os = "windows") {
            "zip"
        } else {
            "tar.gz"
        };
        let archive_dest = ryu_dir()
            .join("tmp")
            .join(format!("ghost-latest.{archive_ext}"));

        // Integrity: verify the ARCHIVE against the sibling `.sha256` the release
        // publishes. Note the scope — this digest covers the downloaded archive
        // (`DownloadSpec::dest`), NOT the `ghost` binary extracted from it, which
        // is hashed separately below and recorded in `versions.json` under the
        // `ghost` key. The two are different values over different bytes; feeding
        // either into the other's comparison would invert the fast path.
        let sha256 = self.fetch_release_sha256(&url).await;
        if sha256.is_none() {
            tracing::warn!(
                "ghost: no usable .sha256 published at {} — downloading unverified",
                sha256_url(&url)
            );
        }

        let archive_path = downloads
            .download_blocking(crate::downloads::DownloadSpec {
                kind: crate::downloads::DownloadKind::Tool,
                label: "Ghost".to_string(),
                url: url.to_string(),
                dest: archive_dest,
                sha256,
                version_record: None,
            })
            .await
            // The 404 case is the one worth naming. The `binaries` matrix covers
            // three platforms; on any other host (Intel macOS today) the hub URL
            // above points at an asset that was never staged, and the transfer
            // engine reports that as a bare `HTTP 404 Not Found for <url>` —
            // indistinguishable from a broken download. State the likelier cause and
            // the remedy here, where the failure is actually observed.
            .with_context(|| {
                format!(
                    "downloading ghost archive from {url}. If this is a 404, this Ryu \
                     release publishes no `{}` — set {GHOST_RELEASE_URL_ENV} to a \
                     self-built or pre-release archive for this platform, or build \
                     ghost from source (apps/ghost in the monorepo, or its public \
                     mirror github.com/amajorai/ghost)",
                    artifact_name()
                )
            })?;
        let archive_data = tokio::fs::read(&archive_path)
            .await
            .context("reading downloaded ghost archive")?;

        // Extract binary from the archive (blocking I/O on a thread-pool thread).
        let binary_name = if cfg!(target_os = "windows") {
            "ghost.exe"
        } else {
            "ghost"
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
        VersionStore::record_persisted("ghost", version, &checksum)
            .context("writing versions.json")?;

        // The extracted binary is in place; drop the temp archive.
        let _ = tokio::fs::remove_file(&archive_path).await;

        // Ensure PATH includes ~/.ryu/bin
        if let Err(e) = crate::sidecar::path_manager::PathManager::add_to_path() {
            tracing::warn!("Failed to add ~/.ryu/bin to PATH: {}", e);
        }

        tracing::info!("ghost installed at {}", dest.display());
        Ok(())
    }
}

impl Default for GhostDownloader {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static GHOST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        GHOST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    struct EnvGuard {
        prev: Option<String>,
    }
    impl EnvGuard {
        fn set(val: &str) -> Self {
            let prev = std::env::var(GHOST_RELEASE_URL_ENV).ok();
            std::env::set_var(GHOST_RELEASE_URL_ENV, val);
            Self { prev }
        }
        fn clear() -> Self {
            let prev = std::env::var(GHOST_RELEASE_URL_ENV).ok();
            std::env::remove_var(GHOST_RELEASE_URL_ENV);
            Self { prev }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(GHOST_RELEASE_URL_ENV, v),
                None => std::env::remove_var(GHOST_RELEASE_URL_ENV),
            }
        }
    }

    #[test]
    fn bin_path_is_the_shared_ghost_bin() {
        assert_eq!(bin_path(), super::super::ghost_bin_path());
    }

    #[test]
    fn artifact_name_uses_the_release_trains_platform_slug() {
        // The whole point of deriving the name: it cannot drift from the slug the
        // release workflow stages assets under. Asserting against a literal is what
        // let `macos-arm64` survive next to a train that publishes `macos-aarch64`.
        let name = artifact_name();
        assert!(name.starts_with("ghost-"), "got: {name}");
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
        // This assertion is the inverse of the one it replaces. The release train
        // now stages `ghost-<platform_tag>.<ext>`, so an unset env must resolve to
        // that asset: refusing here is what kept a published artifact unreachable.
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
        // Composed from `artifact_name()`, so the URL cannot name a platform slug
        // the release workflow does not stage under.
        assert!(url.ends_with(&artifact_name()), "got: {url}");
        // `latest`, not a pinned tag — mirrors `manifest_sidecar`. See source 2.
        assert!(url.contains("/releases/latest/download/"), "got: {url}");
    }

    #[test]
    fn archive_url_uses_env_override_trimmed() {
        // The override still wins over the new default, and is used VERBATIM: it
        // carries a full URL, not a base to append `artifact_name()` to.
        let _lock = lock_env();
        let _g = EnvGuard::set("  https://mirror.test/ghost.tar.gz  ");
        assert_eq!(archive_url(), "https://mirror.test/ghost.tar.gz");
    }

    #[test]
    fn archive_url_blank_env_falls_back_to_the_hub_default() {
        // A blank/whitespace value is "unset", not "an empty URL" — otherwise
        // `RYU_GHOST_RELEASE_URL=` in an env file would make Ghost undownloadable.
        let _lock = lock_env();
        let _g = EnvGuard::set("   ");
        assert!(archive_url().starts_with("https://github.com/"));
        assert!(archive_url().ends_with(&artifact_name()));
    }

    // ── sibling `.sha256` ─────────────────────────────────────────────────────
    //
    // These exercise the pure half only, deliberately. A test that performed a
    // live GET against the hub would be green whenever GitHub is up and says
    // nothing about whether we parse what the release actually publishes.

    #[test]
    fn sha256_url_is_the_published_asset_plus_the_suffix() {
        // The release workflow emits `<asset>.sha256` — an exact sibling, not a
        // separate SHASUMS manifest. If this ever drifts, every download silently
        // falls back to unverified, so pin it against the URL we really request.
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
        // both redirect into the `.sha256` file.
        let hex = "a".repeat(64);
        assert_eq!(
            parse_sha256_digest(&format!("{hex}  ghost-macos-aarch64.tar.gz\n")),
            Some(hex.clone())
        );
        // BSD `shasum` on some hosts emits a single space; and a bare digest is
        // what hand-rolled mirrors tend to produce.
        assert_eq!(
            parse_sha256_digest(&format!("{hex} ghost.tar.gz")),
            Some(hex.clone())
        );
        assert_eq!(parse_sha256_digest(&hex), Some(hex.clone()));
        assert_eq!(parse_sha256_digest(&format!("  \n {hex}\n")), Some(hex));
    }

    #[test]
    fn parse_sha256_digest_lowercases() {
        // `DownloadCenter` compares against `hex::encode`'s lowercase output, so an
        // uppercase digest would fail every transfer as a "checksum mismatch" —
        // a corrupt-download diagnosis for a perfectly good file.
        let upper = "A1B2C3D4".repeat(8);
        assert_eq!(upper.len(), 64);
        assert_eq!(
            parse_sha256_digest(&upper),
            Some("a1b2c3d4".repeat(8)),
            "digest must be normalised to lowercase"
        );
    }

    #[test]
    fn parse_sha256_digest_rejects_anything_that_is_not_a_digest() {
        // Rejection matters more than acceptance: a `None` downloads unverified
        // with a warning, whereas a bogus non-digest would abort the transfer and
        // blame the archive. GitHub answers a missing asset with an HTML page.
        assert_eq!(parse_sha256_digest(""), None);
        assert_eq!(parse_sha256_digest("   \n\t "), None);
        assert_eq!(parse_sha256_digest("<!DOCTYPE html><html>Not Found"), None);
        assert_eq!(parse_sha256_digest(&"a".repeat(63)), None, "too short");
        assert_eq!(parse_sha256_digest(&"a".repeat(65)), None, "too long");
        // 64 chars but not hex — `g` is the classic off-by-one past `f`.
        assert_eq!(parse_sha256_digest(&"g".repeat(64)), None);
        // A trailing filename must not be mistaken for the digest when the digest
        // column itself is malformed.
        assert_eq!(parse_sha256_digest("sha256 ghost.tar.gz"), None);
    }

    #[tokio::test]
    async fn fetch_release_sha256_refuses_non_https_urls() {
        // `RYU_GHOST_RELEASE_URL` is operator input. Over plaintext the checksum is
        // rewritable by whoever rewrote the archive, so we decline rather than
        // perform verification theatre — and the caller warns + downloads
        // unverified, which is at least honest. No network is touched here: the
        // scheme check returns before any request is built.
        let d = GhostDownloader::new();
        assert_eq!(
            d.fetch_release_sha256("http://mirror.test/g.tar.gz").await,
            None
        );
        assert_eq!(
            d.fetch_release_sha256("file:///tmp/ghost.tar.gz").await,
            None
        );
        assert_eq!(d.fetch_release_sha256("/tmp/ghost.tar.gz").await, None);
    }
}
