//! Self-update apply path for the headless binaries (core / gateway / cli) that
//! have no native updater of their own.
//!
//! Status: **code-complete, unverified**. The download + staging is exercisable
//! today, but the binary self-replace and the final installer hand-off cannot be
//! end-to-end verified in this session because there are no signed, published
//! Ryu releases yet (the release CI in `.github/workflows/release.yml` must run
//! once, with the signing secrets configured, before this path has real assets
//! to install). Treat the swap as proven only after a real release exists.
//!
//! Platform note: on Windows a running `.exe` cannot be overwritten in place, so
//! the self-replace renames the live binary aside (`*.old`) and moves the new
//! one into its slot — the classic rename-then-replace. The `.old` file is
//! cleaned up on the next launch.

use anyhow::{anyhow, ensure, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

use super::ReleaseAsset;
use crate::downloads::{DownloadCenter, DownloadKind, DownloadRole, DownloadSpec};
use crate::sidecar::download_manager::ryu_dir;

/// Where downloaded update artifacts are staged before install.
fn staging_dir() -> PathBuf {
    ryu_dir().join("updates")
}

/// Outcome of an apply attempt, returned to the client.
#[derive(Serialize)]
pub struct ApplyResult {
    /// `true` when the new binary was swapped into place (headless self-update).
    pub applied: bool,
    /// `true` when the user/host must take a further step (run an installer, or
    /// restart the process to pick up the swapped binary).
    pub restart_required: bool,
    /// Absolute path of the staged artifact on disk.
    pub staged_path: String,
    /// Human-readable next step.
    pub message: String,
}

/// The caller selects an official asset; it cannot select a filesystem path or
/// a download origin. Resolve its digest independently from the release API.
fn release_tag(asset: &ReleaseAsset) -> Result<String> {
    ensure!(
        !asset.name.is_empty()
            && asset.name != "."
            && asset.name != ".."
            && asset
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')),
        "invalid update asset filename"
    );
    ensure!(
        super::asset_kind(&asset.name) == asset.kind && asset.kind != "unknown",
        "invalid update asset kind"
    );
    let prefix = format!("https://github.com/{}/releases/download/", super::RYU_REPO);
    let suffix = asset
        .url
        .strip_prefix(&prefix)
        .context("update must come from the official release repository")?;
    let (tag, name) = suffix
        .split_once('/')
        .context("invalid release asset URL")?;
    ensure!(
        !tag.is_empty()
            && tag
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')),
        "invalid release tag"
    );
    ensure!(
        name == asset.name,
        "update asset URL and filename do not match"
    );
    Ok(tag.to_owned())
}

fn release_digest(asset: &ReleaseAsset, tag: &str, release: &serde_json::Value) -> Result<String> {
    ensure!(
        release.get("draft").and_then(serde_json::Value::as_bool) == Some(false),
        "update release is not published"
    );
    ensure!(
        release.get("tag_name").and_then(serde_json::Value::as_str) == Some(tag),
        "update release tag mismatch"
    );
    let entry = release
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .and_then(|assets| {
            assets.iter().find(|entry| {
                entry.get("name").and_then(serde_json::Value::as_str) == Some(asset.name.as_str())
                    && entry
                        .get("browser_download_url")
                        .and_then(serde_json::Value::as_str)
                        == Some(asset.url.as_str())
            })
        })
        .context("update asset is not in the published release")?;
    ensure!(
        entry.get("size").and_then(serde_json::Value::as_u64) == Some(asset.size) && asset.size > 0,
        "update asset size mismatch"
    );
    let digest = entry
        .get("digest")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .context("published update has no valid SHA-256 digest")?;
    Ok(digest.to_ascii_lowercase())
}

async fn verified_digest(asset: &ReleaseAsset) -> Result<String> {
    let tag = release_tag(asset)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("ryu-update-verifier")
        .build()?;
    let mut response = client
        .get(format!(
            "https://api.github.com/repos/{}/releases/tags/{tag}",
            super::RYU_REPO
        ))
        .send()
        .await?
        .error_for_status()?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            body.len() + chunk.len() <= 2 * 1024 * 1024,
            "release metadata exceeds size limit"
        );
        body.extend_from_slice(&chunk);
    }
    release_digest(asset, &tag, &serde_json::from_slice(&body)?)
}

/// Download `asset` into the staging dir. Returns the staged file path.
///
/// Goes through the global [`crate::downloads::DownloadCenter`] rather than a bare
/// `reqwest` GET. This is the largest single transfer Core ever performs — a whole
/// release binary or installer — and it used to buffer the entire body in memory
/// with no row anywhere, so a headless `POST /api/update/apply` looked hung for
/// minutes. The center streams it to `<dest>.part`, publishes byte progress to the
/// Downloads page and tray, and makes it pausable/resumable/cancelable like every
/// other artifact.
async fn download_asset(downloads: &DownloadCenter, asset: &ReleaseAsset) -> Result<PathBuf> {
    let digest = verified_digest(asset).await?;
    let dir = staging_dir();
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating staging dir {}", dir.display()))?;

    downloads
        .download_blocking(DownloadSpec {
            kind: DownloadKind::Other,
            role: DownloadRole::Other,
            label: format!("Ryu update ({})", asset.name),
            url: asset.url.clone(),
            dest: dir.join(&asset.name),
            // DownloadCenter verifies bytes against independently fetched metadata.
            sha256: Some(digest),
            version_record: None,
        })
        .await
        .context("downloading update asset")
}

/// Windows-safe in-place replace of the currently running executable.
///
/// Renames the live binary to `<exe>.old` (allowed even while running) and moves
/// the freshly downloaded binary into the original path. The caller must restart
/// the process for the new binary to take effect.
fn replace_current_exe(new_binary: &Path) -> Result<()> {
    let current = std::env::current_exe().context("resolving current exe")?;
    let backup = current.with_extension("old");
    // Best-effort: remove a stale backup from a prior update.
    let _ = std::fs::remove_file(&backup);
    std::fs::rename(&current, &backup)
        .with_context(|| format!("renaming live exe aside to {}", backup.display()))?;
    // Move the new binary into the original slot. Copy+remove rather than rename
    // so it works across volumes (the staging dir may be on a different drive).
    std::fs::copy(new_binary, &current)
        .with_context(|| format!("installing new exe at {}", current.display()))?;
    let _ = std::fs::remove_file(new_binary);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&current)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&current, perms)?;
    }
    Ok(())
}

/// Clean up the `<exe>.old` backup left by a previous self-update. Called once
/// on Core startup so the staging crumbs don't accumulate.
pub fn cleanup_stale_backup() {
    if let Ok(current) = std::env::current_exe() {
        let backup = current.with_extension("old");
        if backup.exists() {
            let _ = std::fs::remove_file(backup);
        }
    }
}

/// Apply an update from a resolved [`ReleaseAsset`].
///
/// - For a raw executable/archive (`exe`/`archive`) we perform the headless
///   self-replace and report `restart_required`.
/// - For OS installers (`msi`/`dmg`/`deb`/`appimage`) we stage the file and hand
///   the path back; the client runs the platform installer (Core does not launch
///   GUI installers itself).
pub async fn apply_update(downloads: &DownloadCenter, asset: &ReleaseAsset) -> Result<ApplyResult> {
    let staged = download_asset(downloads, asset).await?;
    let staged_str = staged.display().to_string();

    match asset.kind.as_str() {
        // A bare binary we can swap directly. (Archive handling — unpacking then
        // locating the inner binary — is intentionally deferred until real
        // release artifacts exist to validate the layout against.)
        "exe" if cfg!(windows) => {
            replace_current_exe(&staged)?;
            Ok(ApplyResult {
                applied: true,
                restart_required: true,
                staged_path: staged_str,
                message: "Update installed. Restart Ryu Core to run the new version.".to_string(),
            })
        }
        "msi" | "dmg" | "deb" | "appimage" => Ok(ApplyResult {
            applied: false,
            restart_required: true,
            staged_path: staged_str,
            message: format!(
                "Update downloaded. Run the {} installer to complete the update.",
                asset.kind
            ),
        }),
        "archive" | "exe" => Ok(ApplyResult {
            applied: false,
            restart_required: true,
            staged_path: staged_str,
            message: "Update downloaded. Extract and replace the binary to complete the update."
                .to_string(),
        }),
        other => Err(anyhow!("unsupported update asset kind: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn asset() -> ReleaseAsset {
        ReleaseAsset {
            name: "ryu-core.zip".into(),
            url: format!(
                "https://github.com/{}/releases/download/v0.3.0/ryu-core.zip",
                super::super::RYU_REPO
            ),
            kind: "archive".into(),
            size: 123,
        }
    }

    #[test]
    fn update_mutations_require_node_management_before_side_effects() {
        let source = include_str!("../server/mod.rs");
        for (handler, mutation) in [
            (
                "async fn update_apply(",
                "crate::update::apply::apply_update(",
            ),
            (
                "async fn schedule_update(",
                "crate::update::schedule::set_pending(",
            ),
            (
                "async fn cancel_update_schedule(",
                "crate::update::schedule::clear_pending(",
            ),
        ] {
            let body = source
                .split_once(handler)
                .unwrap()
                .1
                .split_once("\n}\n")
                .unwrap()
                .0;
            let permission = body
                .find("crate::identity_verify::permissions::NODES_MANAGE")
                .unwrap();
            assert!(body.contains("if let Err(status) = enforce_permission("));
            assert!(permission < body.find(mutation).unwrap(), "{handler}");
        }
    }

    #[test]
    fn refuses_untrusted_update_paths_and_origins() {
        assert_eq!(release_tag(&asset()).unwrap(), "v0.3.0");
        for name in [
            "../ryu-core.zip",
            "/tmp/ryu-core.zip",
            "..\\ryu-core.zip",
            "ryu-core.zip?x",
            "ryu-core.zip#x",
        ] {
            let mut value = asset();
            value.name = name.into();
            assert!(release_tag(&value).is_err());
        }
        for url in [
            "http://github.com/other/file.zip",
            "https://evil.example/ryu-core.zip",
            "https://github.com/other/repo/releases/download/v0.3.0/ryu-core.zip",
        ] {
            let mut value = asset();
            value.url = url.into();
            assert!(release_tag(&value).is_err());
        }
    }

    #[test]
    fn requires_matching_published_metadata_and_sha256() {
        let asset = asset();
        let digest = "ab".repeat(32);
        let mut release = json!({"tag_name":"v0.3.0", "draft":false, "assets":[{"name":asset.name,"browser_download_url":asset.url,"size":123,"digest":format!("sha256:{digest}")}]});
        assert_eq!(release_digest(&asset, "v0.3.0", &release).unwrap(), digest);
        for invalid in [
            serde_json::Value::Null,
            json!("sha256:bad"),
            json!("md5:abc"),
        ] {
            release["assets"][0]["digest"] = invalid;
            assert!(release_digest(&asset, "v0.3.0", &release).is_err());
        }
        release["assets"][0]["digest"] = json!(format!("sha256:{digest}"));
        release["draft"] = json!(true);
        assert!(release_digest(&asset, "v0.3.0", &release).is_err());
        release["draft"] = json!(false);
        release["assets"][0]["size"] = json!(124);
        assert!(release_digest(&asset, "v0.3.0", &release).is_err());
    }
}
