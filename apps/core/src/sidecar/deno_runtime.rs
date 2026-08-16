//! Deno runtime installer — the in-product way to get the `deno` binary that
//! **code mode** (programmatic tool calling) runs on.
//!
//! `ryu-tool-exec`'s default backend is a Deno subprocess, and its
//! `is_available()` is a live `deno --version` probe (`deno_backend::deno_on_path`).
//! Until this module existed nothing in the repo ever *put* a `deno` on the
//! machine, so on a stock install that probe failed, `execute`/`resume` were
//! never offered to the model, and code mode was silently absent — no error, no
//! log, just a capability that never appeared. `path_manager` already puts
//! `~/.deno/bin` on PATH but has never populated it, which made the gap look
//! deliberate.
//!
//! ## Adopt first, install second
//!
//! PATH adoption WINS, exactly like [`super::tailscale`]'s mesh pair: a machine
//! that already has Deno (or an operator who pointed `RYU_DENO_BIN` at a build)
//! keeps its own, and Ryu never mutates a toolchain it does not own. The
//! download is strictly the fallback for a machine that has none.
//!
//! ## Why upstream's asset table is uniform here (unlike Tailscale's)
//!
//! `denoland/deno` publishes ONE shape for every target — a `.zip` containing a
//! single `deno` binary at the archive root, named `deno-<rust-triple>.zip`. So
//! this is a plain single-binary downloader in the shape of
//! [`super::tools::restate::downloader`], with one deliberate deviation: the
//! platform table is a **pure function of `(os, arch)`** rather than a stack of
//! `cfg!` blocks, because a mapping asserted only against the host arch is a
//! mapping asserted against one row (the reasoning [`super::tailscale::downloader`]
//! spells out for its own `goarch_of`).
//!
//! ## Deliberately no `PathManager::add_to_path()`
//!
//! Every other downloader here appends `~/.ryu/bin` to the user's shell profile.
//! This one must not: a second `deno` on an interactive PATH shadows whichever
//! toolchain the user meant to use, and it buys nothing, because a successful
//! install exports [`DENO_BIN_ENV`] into THIS process and `deno_bin()` re-reads
//! that env on every call. The export does not survive a restart — it does not
//! need to: [`ensure_deno_in_background`] re-adopts the managed copy on the
//! first tool listing of the next boot, at the cost of one `is_file()`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};

use crate::sidecar::download_manager::{
    bin_dir, build_http_client, download_to_memory, extract_from_zip, retry_download, VersionStore,
};
use crate::win_process::NoWindow;

/// The upstream release this Core installs, pinned at compile time.
///
/// Pinned rather than floating for the reason [`super::tailscale::downloader`]
/// documents at length: the version Ryu advertises must be the version an
/// install can actually DELIVER, and old GitHub release assets persist forever,
/// so a pin cannot rot into a 404 the way a `latest`-shaped URL rots into a
/// mismatch. Cost stated plainly: a Deno release does not reach users until the
/// next Ryu release. [`VERSION_ENV`] is the escape hatch in the meantime.
const DENO_TARGET_VERSION: &str = "2.9.5";

/// The ONE place the release host lives. [`archive_url`] is the only composer,
/// so the base can never be spelled twice and drift.
const DENO_RELEASE_BASE: &str = "https://github.com/denoland/deno/releases/download";

/// Overrides [`DENO_TARGET_VERSION`] (blank = unset), mirroring
/// `RYU_RESTATE_VERSION`.
const VERSION_ENV: &str = "RYU_DENO_VERSION";

/// The env `ryu-tool-exec`'s `deno_bin()` reads to locate the interpreter. A
/// successful install exports it into this process so the very next
/// `is_available()` probe finds the managed copy without a restart.
const DENO_BIN_ENV: &str = "RYU_DENO_BIN";

/// The binary inside the archive, and the name it lands under. `versions.json`
/// keys on this too.
const BIN_NAME: &str = "deno";

/// `deno` with the platform's executable extension.
fn exe_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "deno.exe"
    } else {
        "deno"
    }
}

/// Where a Ryu-managed `deno` lives: the PROFILE-AWARE bin dir. `bin_dir()`
/// resolves through `crate::paths::ryu_dir()`, so a `RYU_PROFILE=dev` Core
/// installs into `~/.ryu-dev/bin` and never touches the release profile's copy.
pub(crate) fn managed_path() -> PathBuf {
    bin_dir().join(exe_name())
}

/// The upstream asset name for `(os, arch)`, or `None` when Deno publishes no
/// build for that pair.
///
/// `os`/`arch` are the `std::env::consts` spellings. Deno names its assets after
/// the Rust target triple, so unlike Tailscale's `GOARCH` table this is a
/// straight rename rather than a translation — but it is still a table, and it
/// is still `None` for an unpublished pair so [`archive_url`] refuses instead of
/// synthesizing a URL that 404s.
fn asset_name(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("deno-aarch64-apple-darwin.zip"),
        ("macos", "x86_64") => Some("deno-x86_64-apple-darwin.zip"),
        ("linux", "aarch64") => Some("deno-aarch64-unknown-linux-gnu.zip"),
        ("linux", "x86_64") => Some("deno-x86_64-unknown-linux-gnu.zip"),
        ("windows", "x86_64") => Some("deno-x86_64-pc-windows-msvc.zip"),
        _ => None,
    }
}

/// The version to install: [`VERSION_ENV`] when set and non-blank, else the pin.
fn pinned_version() -> String {
    std::env::var(VERSION_ENV)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DENO_TARGET_VERSION.to_owned())
}

/// The release URL for this host, composed from [`DENO_RELEASE_BASE`],
/// [`pinned_version`] and [`asset_name`] — the only composer, so the base and
/// the version are each spelled once.
fn archive_url() -> Result<String> {
    let asset = asset_name(std::env::consts::OS, std::env::consts::ARCH).ok_or_else(|| {
        anyhow::anyhow!(
            "Deno publishes no build for this platform ({}/{}). Install Deno yourself \
             (https://deno.com) and code mode will adopt it, or point {DENO_BIN_ENV} at a \
             `deno` binary.",
            std::env::consts::OS,
            std::env::consts::ARCH,
        )
    })?;
    Ok(format!(
        "{DENO_RELEASE_BASE}/v{version}/{asset}",
        version = pinned_version()
    ))
}

/// Which install a resolved `deno` came from. Only [`DenoSource::Managed`] is
/// ours to export into [`DENO_BIN_ENV`] — an operator's override is already
/// there, and a PATH copy is found by `deno_bin()`'s bare-name spawn anyway.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DenoSource {
    /// `RYU_DENO_BIN` pointed at it.
    Override,
    /// Resolved by walking `PATH`.
    Path,
    /// The Ryu-managed copy in the profile bin dir.
    Managed,
}

/// A usable `deno` already reachable on this machine, in precedence order:
/// [`DENO_BIN_ENV`] → `PATH` → the managed copy.
///
/// Deliberately a file/PATH probe rather than a `deno --version` spawn: this
/// runs on the tool-listing path, and both neighbouring downloaders
/// (`tailscale::downloader::can_install`, restate's fast path) keep their
/// "already installed?" question synchronous and subprocess-free for the same
/// reason. The `--version` spawn happens once, after an install, in
/// [`ensure_deno`].
fn existing_deno() -> Option<(PathBuf, DenoSource)> {
    let overridden = std::env::var(DENO_BIN_ENV)
        .ok()
        .map(|p| p.trim().to_owned())
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    if let Some(path) = overridden {
        // A bare name (`RYU_DENO_BIN=deno`) is legitimate — `deno_bin()` spawns
        // it through PATH — so fall through to the PATH walk rather than
        // rejecting it as a missing file.
        if path.is_file() {
            return Some((path, DenoSource::Override));
        }
        if let Some(resolved) =
            crate::sidecar::adapters::acp::resolve_in_path(&path.to_string_lossy())
        {
            return Some((resolved, DenoSource::Override));
        }
    }
    if let Some(path) = crate::sidecar::adapters::acp::resolve_in_path(BIN_NAME) {
        return Some((path, DenoSource::Path));
    }
    let managed = managed_path();
    if managed.is_file() {
        return Some((managed, DenoSource::Managed));
    }
    None
}

/// Export `path` as [`DENO_BIN_ENV`] for the rest of this process, so
/// `ryu-tool-exec`'s `deno_bin()` picks the managed binary up on its very next
/// probe. Nothing caches the value — `deno_bin()` re-reads the env per call —
/// so this takes effect without a restart.
fn adopt_managed(path: &std::path::Path) {
    std::env::set_var(DENO_BIN_ENV, path);
}

/// Ensure a runnable `deno` exists, returning its path.
///
/// Adopts before installing (see the module doc). On the install leg: download
/// the pinned per-platform zip, extract the single `deno` out of it, land it in
/// the profile bin dir through a unique temp + rename, set the executable bit,
/// verify with `deno --version`, record the version, and export
/// [`DENO_BIN_ENV`].
///
/// Idempotent, and safe against a second Core on the same profile: the temp name
/// carries this process's pid, so two concurrent installs can never interleave
/// bytes into one scratch file. (The loser's `rename` may still fail on Windows,
/// where moving over a running `.exe` is a sharing violation; that install bails
/// and re-adopts the winner's binary on the next trigger.)
pub async fn ensure_deno() -> Result<PathBuf> {
    if let Some((path, source)) = existing_deno() {
        if source == DenoSource::Managed {
            adopt_managed(&path);
        }
        tracing::debug!(path = %path.display(), ?source, "deno already available");
        return Ok(path);
    }

    let url = archive_url()?;
    let version = pinned_version();
    tracing::info!("code mode: downloading the Deno runtime from {url}");

    let client = build_http_client();
    let archive_data = retry_download(BIN_NAME, 3, || {
        let client = client.clone();
        let url = url.clone();
        async move { download_to_memory(&client, &url, BIN_NAME, None).await }
    })
    .await
    // Name the asset in the 404 case rather than reporting a bare status, in
    // the tailscale downloader's style.
    .with_context(|| {
        format!(
            "downloading the Deno archive from {url}. If this is a 404, no `{}` was published \
             for v{version} — install Deno yourself (https://deno.com) or point {DENO_BIN_ENV} \
             at a `deno` binary.",
            asset_name(std::env::consts::OS, std::env::consts::ARCH).unwrap_or("deno-<triple>.zip"),
        )
    })?;

    // Blocking zip work off the reactor. The archive holds exactly one entry
    // (`deno`), so a single-binary extract is the whole job.
    let extracted = tokio::task::spawn_blocking(move || extract_from_zip(&archive_data, BIN_NAME))
        .await
        .context("spawn_blocking for Deno archive extraction")??;

    let dest = managed_path();
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    // A pid-unique temp, NOT a shared `<dest>.tmp`: two Cores on one profile
    // would otherwise write the same scratch file concurrently, and on Windows
    // `deno.exe`.with_extension("tmp") also silently drops the `.exe`. The flip
    // side of uniqueness is that a crashed install cannot be overwritten by the
    // next one, so every failure path below reaps its own 80 MB scratch file.
    let tmp = dest.with_file_name(format!(
        "{}.{}.download-tmp",
        exe_name(),
        std::process::id()
    ));
    let landed = land_binary(&tmp, &dest, &extracted).await;
    if landed.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    landed?;

    // Verify by running it — the same question `is_available()` will ask. A zip
    // that extracted cleanly but cannot execute (wrong arch, missing loader)
    // must fail HERE, where the message names the cause, rather than silently
    // leaving code mode off.
    //
    // And on failure the binary is REMOVED, not left in place. `existing_deno`
    // treats any file at `managed_path()` as usable, so a non-runnable one would
    // short-circuit every future call, be adopted into `RYU_DENO_BIN`, and wedge
    // code mode off forever with no path back to the install leg — strictly
    // worse than the never-installed state this is supposed to degrade to.
    if !runs_ok(&dest).await {
        let _ = tokio::fs::remove_file(&dest).await;
        anyhow::bail!(
            "installed {} but `deno --version` did not succeed — removed it again and left \
             code mode unavailable",
            dest.display(),
        );
    }

    let checksum = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&extracted);
        hex::encode(hasher.finalize())
    };
    if let Err(e) = VersionStore::record_persisted(BIN_NAME, &version, &checksum) {
        // Not fatal: the binary is on disk and usable, and the record only
        // drives the update surface.
        tracing::warn!("could not persist the deno version marker: {e}");
    }

    adopt_managed(&dest);
    tracing::info!(path = %dest.display(), "code mode: Deno {version} installed");
    Ok(dest)
}

/// Write `bytes` to `tmp`, make it executable, and rename it onto `dest`.
///
/// Split out of [`ensure_deno`] so a single caller-side `is_err()` can reap the
/// scratch file whichever of the three steps failed.
///
/// The executable bit is set BEFORE the rename, deliberately: `dest` is then
/// never observable in a non-runnable state, and skipping it entirely would
/// surface only as a "Permission denied" at spawn time, far from here.
async fn land_binary(tmp: &std::path::Path, dest: &std::path::Path, bytes: &[u8]) -> Result<()> {
    tokio::fs::write(tmp, bytes)
        .await
        .with_context(|| format!("writing {}", tmp.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(tmp)
            .with_context(|| format!("stat {}", tmp.display()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(tmp, perms)
            .with_context(|| format!("chmod 0755 {}", tmp.display()))?;
    }

    tokio::fs::rename(tmp, dest)
        .await
        .with_context(|| format!("rename {} -> {}", tmp.display(), dest.display()))
}

/// Whether `path` answers `--version`. Mirrors `ryu-tool-exec`'s own
/// `deno_on_path` probe (including `no_window()`, so a Windows install never
/// flashes a console).
async fn runs_ok(path: &std::path::Path) -> bool {
    tokio::process::Command::new(path)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .no_window()
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Process-global once-latch for [`ensure_deno_in_background`].
static PROVISION_STARTED: AtomicBool = AtomicBool::new(false);

/// Lazy, once-per-process trigger: make sure code mode has a runtime, without
/// ever blocking the caller.
///
/// Called from the tool-listing path — the point where code-mode availability
/// actually matters — so a stock install acquires Deno the first time an agent
/// is offered tools, rather than at boot (which would spend a download on nodes
/// that never run code mode).
///
/// Three deliberate properties:
/// - **Adoption is synchronous**, because it is one `is_file()` plus one
///   `set_var`; doing it inline means code mode is live on THIS listing rather
///   than the next one.
/// - **Installation is detached**, so neither startup nor a request ever waits
///   on a download.
/// - **Failure is quiet.** A failed install logs at warn and leaves code mode
///   unavailable — exactly the state the node was already in. It must never
///   surface as an error on a user-visible path.
///
/// No-op under `cfg(test)`: `build_tool_list`'s own `#[tokio::test]`s would
/// otherwise reach the network from a unit test.
pub fn ensure_deno_in_background() {
    if cfg!(test) {
        return;
    }
    if PROVISION_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }

    if let Some((path, source)) = existing_deno() {
        if source == DenoSource::Managed {
            adopt_managed(&path);
        }
        tracing::debug!(path = %path.display(), ?source, "code mode: adopting an existing Deno");
        return;
    }

    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        // Nothing to spawn onto. Release the latch so an in-runtime caller
        // still gets its one attempt.
        PROVISION_STARTED.store(false, Ordering::Relaxed);
        return;
    };
    handle.spawn(async {
        if let Err(e) = ensure_deno().await {
            tracing::warn!("code mode stays unavailable — could not provision Deno: {e:#}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // `VERSION_ENV`/`DENO_BIN_ENV` are process-global and `cargo test` runs test
    // fns in parallel, so every test that touches one takes this lock (the shape
    // restate's and tailscale's test modules use).
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn lock_env() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }
    impl EnvGuard {
        fn set(key: &'static str, val: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, val);
            Self { key, prev }
        }
        fn clear(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }

    /// A real file that is NOT executable, standing in for an installed `deno`.
    ///
    /// Deliberately not the test binary: a parallel test calling
    /// `tool_exec::is_available()` while `RYU_DENO_BIN` points at it would spawn
    /// the libtest harness recursively. A non-executable file makes that spawn
    /// fail harmlessly.
    struct FakeBin(PathBuf);
    impl FakeBin {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ryu-deno-test-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::write(&path, b"not a real deno").expect("writing the fake bin");
            Self(path)
        }
    }
    impl Drop for FakeBin {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn asset_name_covers_every_published_target() {
        // All five targets Deno publishes. Asserted as a table rather than
        // through `cfg!`, because a mapping checked only against the host arch
        // is a mapping checked against one row.
        assert_eq!(
            asset_name("macos", "aarch64"),
            Some("deno-aarch64-apple-darwin.zip")
        );
        assert_eq!(
            asset_name("macos", "x86_64"),
            Some("deno-x86_64-apple-darwin.zip")
        );
        assert_eq!(
            asset_name("linux", "aarch64"),
            Some("deno-aarch64-unknown-linux-gnu.zip")
        );
        assert_eq!(
            asset_name("linux", "x86_64"),
            Some("deno-x86_64-unknown-linux-gnu.zip")
        );
        assert_eq!(
            asset_name("windows", "x86_64"),
            Some("deno-x86_64-pc-windows-msvc.zip")
        );
    }

    #[test]
    fn asset_name_refuses_unpublished_pairs() {
        // Upstream ships no 32-bit, no riscv, and no aarch64 Windows build.
        // `None` is what makes `archive_url` bail with advice instead of
        // composing a URL that 404s.
        assert_eq!(asset_name("linux", "riscv64"), None);
        assert_eq!(asset_name("linux", "x86"), None);
        assert_eq!(asset_name("windows", "aarch64"), None);
        assert_eq!(asset_name("freebsd", "x86_64"), None);
        // The os/arch spellings are `std::env::consts`', not triple fragments.
        assert_eq!(asset_name("apple-darwin", "aarch64"), None);
    }

    #[test]
    fn archive_url_is_composed_from_one_base_and_one_version() {
        let _lock = lock_env();
        let _g = EnvGuard::clear(VERSION_ENV);
        let Some(asset) = asset_name(std::env::consts::OS, std::env::consts::ARCH) else {
            // No published build here — `archive_url` must refuse rather than
            // synthesize a URL that cannot exist.
            assert!(archive_url().is_err());
            return;
        };
        let url = archive_url().expect("a url");
        assert_eq!(
            url,
            format!("{DENO_RELEASE_BASE}/v{DENO_TARGET_VERSION}/{asset}"),
            "got: {url}"
        );
        // https only: these bytes get executed.
        assert!(url.starts_with("https://"), "got: {url}");
    }

    #[test]
    fn archive_url_honours_the_version_override_and_treats_blank_as_unset() {
        let _lock = lock_env();
        if asset_name(std::env::consts::OS, std::env::consts::ARCH).is_none() {
            return;
        }
        {
            let _g = EnvGuard::set(VERSION_ENV, "  9.9.9  ");
            let url = archive_url().expect("a url");
            assert!(url.contains("/v9.9.9/"), "got: {url}");
        }
        // Blank is "unset", not "an empty version" — otherwise `RYU_DENO_VERSION=`
        // in an env file would compose `/v/` and 404 forever.
        let _g = EnvGuard::set(VERSION_ENV, "   ");
        assert_eq!(pinned_version(), DENO_TARGET_VERSION);
        let url = archive_url().expect("a url");
        assert!(
            url.contains(&format!("/v{DENO_TARGET_VERSION}/")),
            "got: {url}"
        );
    }

    #[tokio::test]
    async fn ensure_deno_short_circuits_on_an_already_available_binary() {
        // THE property that keeps this conservative: a machine that already has
        // Deno must not be mutated, and the call must not touch the network.
        let _lock = lock_env();
        let fake = FakeBin::new("short-circuit");
        let _g = EnvGuard::set(DENO_BIN_ENV, &fake.0.to_string_lossy());

        let (found, source) = existing_deno().expect("the override resolves");
        assert_eq!(found, fake.0);
        assert_eq!(source, DenoSource::Override);

        // `ensure_deno` returns that same path without downloading anything —
        // there is no network in this test, so reaching the install leg would
        // fail rather than pass.
        let path = ensure_deno().await.expect("the short circuit");
        assert_eq!(path, fake.0);
        // And it left the operator's override exactly as it found it.
        assert_eq!(
            std::env::var(DENO_BIN_ENV).ok().map(PathBuf::from),
            Some(fake.0.clone())
        );
    }

    #[test]
    fn a_blank_override_is_ignored_rather_than_treated_as_a_path() {
        let _lock = lock_env();
        let _g = EnvGuard::set(DENO_BIN_ENV, "   ");
        // Whatever this machine resolves (PATH copy, managed copy, or nothing),
        // it must not be attributed to the override.
        assert!(existing_deno().is_none_or(|(_, s)| s != DenoSource::Override));
    }

    #[test]
    fn a_missing_override_target_falls_through_instead_of_winning() {
        let _lock = lock_env();
        let _g = EnvGuard::set(DENO_BIN_ENV, "/nonexistent/ryu/deno-does-not-exist");
        // A dangling override must not be reported as an available binary, or
        // `ensure_deno` would hand back a path that cannot spawn.
        assert!(existing_deno()
            .is_none_or(|(p, _)| p != PathBuf::from("/nonexistent/ryu/deno-does-not-exist")));
    }

    #[test]
    fn the_managed_copy_lands_in_the_profile_bin_dir() {
        // Profile-awareness comes from `bin_dir()` → `crate::paths::ryu_dir()`,
        // so a `RYU_PROFILE=dev` Core installs into `~/.ryu-dev/bin`. Never
        // `dirs::home_dir()` directly.
        let path = managed_path();
        assert_eq!(path.parent().unwrap(), bin_dir());
        assert!(path.ends_with(exe_name()));
    }

    #[test]
    fn the_background_trigger_is_inert_under_cfg_test() {
        // `build_tool_list` — the call site — is exercised by `#[tokio::test]`s.
        // If this ever starts spawning, those tests reach the network.
        let before = PROVISION_STARTED.load(Ordering::Relaxed);
        ensure_deno_in_background();
        assert_eq!(PROVISION_STARTED.load(Ordering::Relaxed), before);
    }
}
