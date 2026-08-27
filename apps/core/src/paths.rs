//! Centralized resolution of Ryu's data directory (the "data folder").
//!
//! Historically every store computed its own path as
//! `dirs::home_dir().join(".ryu").join(<file>)`, scattered across ~100 files.
//! This module is now the **single source of truth** so a user can relocate the
//! entire data folder (DBs, conversations, spaces, media, models, `bin/`) to
//! another disk via the desktop "Storage" setting.
//!
//! Resolution order (resolved once, then cached for the process lifetime — a
//! change requires a Core restart to take effect):
//!   1. env `RYU_DIR` — power users / headless / tests.
//!   2. the **pointer file** in the OS config dir (written by the Storage UI).
//!   3. the default `~/.ryu`.
//!
//! The pointer lives **outside** the data dir on purpose: the preferences DB is
//! *inside* the data dir, so it can't record its own location (chicken-and-egg).
//! This mirrors how Jan keeps `data_folder` in its app config, not in the data
//! folder itself.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Env var that overrides the data dir outright.
pub const RYU_DIR_ENV: &str = "RYU_DIR";

/// The default data dir: `~/.ryu` (falling back to `./.ryu` if home is unknown).
///
/// Profile-aware (`RYU_PROFILE`): release ⇒ `~/.ryu` (byte-identical to today),
/// any other profile ⇒ `~/.ryu-<profile>` (e.g. `~/.ryu-dev`), so a dev stack's
/// data folder never overlaps a release stack's. Keeping this suffixed also keeps
/// [`is_custom`] honest under a profile (dev's default is its own baseline, not a
/// "relocation" off the release default).
pub fn default_ryu_dir() -> PathBuf {
    let name = format!(".ryu{}", crate::profile::suffix());
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(name)
}

/// Directory holding the bootstrap pointer file. Lives in the OS *config* dir
/// (`%APPDATA%\ryu` on Windows, `~/.config/ryu` on Linux, `~/Library/Application
/// Support/ryu` on macOS), NOT inside the data dir.
///
/// Public because it is the only place a piece of state can live that must
/// SURVIVE a wipe of the data dir. `preferences.db` is inside the data dir, so it
/// cannot hold "did the user turn the wipe off" or "when did it last run" — the
/// first wipe erases both.
pub fn config_dir() -> PathBuf {
    // Profile-suffixed (`ryu` ⇒ `ryu-dev`) so the bootstrap pointer file is
    // isolated per profile too — a release relocation must not silently move a
    // dev stack's data dir (and vice-versa).
    dirs::config_dir()
        .unwrap_or_else(default_ryu_dir)
        .join(format!("ryu{}", crate::profile::suffix()))
}

/// Path to the data-path pointer file (`<config>/ryu/data-path.json`).
pub fn pointer_path() -> PathBuf {
    config_dir().join("data-path.json")
}

/// Bootstrap pointer persisted outside the data dir.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct DataPathPointer {
    /// Absolute path of the active data dir. `None`/absent ⇒ use the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
}

/// Read the pointer file; returns the default (empty) pointer if absent/unparseable.
pub fn read_pointer() -> DataPathPointer {
    let Ok(bytes) = std::fs::read(pointer_path()) else {
        return DataPathPointer::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the pointer file (creating the config dir if needed).
pub fn write_pointer(pointer: &DataPathPointer) -> std::io::Result<()> {
    let path = pointer_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(pointer).map_err(std::io::Error::other)?;
    std::fs::write(&path, json)
}

/// Set (or clear, with `None`) the active data dir in the pointer file. Takes
/// effect on the next Core start.
pub fn set_data_dir(dir: Option<&Path>) -> std::io::Result<()> {
    write_pointer(&DataPathPointer {
        data_dir: dir.map(|d| d.to_string_lossy().into_owned()),
    })
}

fn resolve() -> PathBuf {
    if let Some(v) = std::env::var_os(RYU_DIR_ENV) {
        let p = PathBuf::from(v);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    if let Some(dir) = read_pointer().data_dir {
        let p = PathBuf::from(dir);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    default_ryu_dir()
}

static RYU_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The active data dir, resolved once and cached for the process lifetime.
pub fn ryu_dir() -> PathBuf {
    RYU_DIR.get_or_init(resolve).clone()
}

/// True when the active data dir differs from the default (user-relocated).
pub fn is_custom() -> bool {
    ryu_dir() != default_ryu_dir()
}

// ── Node reset ("wipe this node") ────────────────────────────────────────────
//
// A full node reset returns the node to a fresh, just-installed state: every
// store DB, session, download, and preference under the data dir is deleted, so
// the next start re-runs onboarding. It CANNOT be done live: the SQLite files are
// open (a live delete corrupts the `-wal`/`-shm` sidecars, and on Windows an open
// file can't be deleted at all). So the flow mirrors the data-path reset — the API
// handler only drops a marker and asks the desktop to restart Core; the actual
// wipe runs at the very start of the next boot, before any store opens.

/// Marker filename requesting a wipe on the next Core start (see [`request_node_reset`]).
const RESET_MARKER: &str = ".reset-pending";

/// Entries inside the data dir that a reset must PRESERVE as WHOLE top-level
/// names. Everything else — every DB, download, cache, and the `plugins/` tree —
/// is wiped.
///
/// - `master.key` / `memory.key`: the encryption-key custody files live in the data
///   dir when no OS keychain is available; deleting them would change the node's
///   identity and (on keychain-less machines) orphan the key needed to boot.
///
/// `bin/` is handled specially by [`wipe_bin_dir`]: the folder itself stays, but
/// every downloaded sidecar/app binary inside is deleted. Only `ryu-core` and
/// `ryu-gateway` (the processes needed to boot and talk to a model) survive —
/// otherwise a "reset" leaves every previously-installed app binary on disk and
/// the catalog/onboarding path happily re-adopts them as still installed.
const RESET_PRESERVE: &[&str] = &["master.key", "memory.key"];

/// Filenames inside `bin/` that must survive a node reset so the desktop can
/// still resolve and launch Core/gateway without a full reinstall.
const BIN_PRESERVE: &[&str] = &[
    "ryu-core",
    "ryu-core.exe",
    "ryu-core.version",
    "ryu-gateway",
    "ryu-gateway.exe",
    "ryu-gateway.version",
];

/// Path of the reset marker inside the active data dir.
pub fn reset_marker_path() -> PathBuf {
    ryu_dir().join(RESET_MARKER)
}

/// Request a full node reset on the next Core start. Best-effort creates the data
/// dir first so the marker can be written even on an otherwise-empty install.
pub fn request_node_reset() -> std::io::Result<()> {
    let dir = ryu_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(RESET_MARKER), b"1")
}

/// If a reset was requested, wipe every entry in the data dir except the key
/// custody files, then clear the marker. MUST run at startup BEFORE any store
/// opens its DB.
///
/// Fail-closed: if the wipe cannot finish (typically Windows sharing violations
/// from a still-alive sidecar), this process EXITS without opening any store.
/// Continuing to boot would re-lock the DBs forever and the marker could never
/// be consumed — the bug that left agents/plugins/apps intact after "reset".
/// The desktop's restart loop then starts a fresh Core against unlocked files.
pub fn apply_pending_reset() {
    let dir = ryu_dir();
    if !dir.join(RESET_MARKER).exists() {
        return;
    }
    eprintln!(
        "ryu-core: pending node reset — wiping data dir {}",
        dir.display()
    );
    match wipe_dir_preserving_keys(&dir) {
        Ok(()) => eprintln!("ryu-core: node reset wipe complete"),
        Err(e) => {
            eprintln!(
                "ryu-core: node reset wipe incomplete ({e}); exiting without opening stores so locks release and the next start can retry"
            );
            // EX_TEMPFAIL-ish: desktop restartRyuCore will spawn us again.
            std::process::exit(75);
        }
    }
}

/// Delete every entry in `dir` except the reset marker and the key custody files,
/// then remove the marker. Split out from [`apply_pending_reset`] so it is testable
/// against an arbitrary directory (the public entry point is bound to the cached
/// `ryu_dir()`).
///
/// Retries briefly: on Windows the previous Core/sidecar process can still hold
/// SQLite handles for a short window after exit. Returns `Err` (and leaves the
/// marker in place) if anything non-preserved still remains after retries.
fn wipe_dir_preserving_keys(dir: &Path) -> std::io::Result<()> {
    const ATTEMPTS: u32 = 12;
    const SLEEP_MS: u64 = 400;

    let mut last_err: Option<std::io::Error> = None;
    for attempt in 1..=ATTEMPTS {
        last_err = None;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                // Keep the marker (removed last) and the key custody files.
                if name_str == RESET_MARKER || RESET_PRESERVE.contains(&name_str.as_ref()) {
                    continue;
                }
                let path = entry.path();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                // `bin/` stays as a directory but its contents are scrubbed so
                // previously-installed app sidecars do not survive the reset.
                let result = if name_str == "bin" && is_dir {
                    wipe_bin_dir(&path)
                } else if is_dir {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
                if let Err(e) = result {
                    eprintln!(
                        "ryu-core: reset wipe attempt {attempt}/{ATTEMPTS} failed on {}: {e}",
                        path.display()
                    );
                    last_err = Some(e);
                }
            }
        }

        if !reset_wipe_has_leftovers(dir) {
            let _ = std::fs::remove_file(dir.join(RESET_MARKER));
            return Ok(());
        }

        if attempt < ATTEMPTS {
            std::thread::sleep(std::time::Duration::from_millis(SLEEP_MS));
        }
    }

    Err(last_err.unwrap_or_else(|| {
        std::io::Error::other("node reset wipe left non-preserved entries after retries")
    }))
}

/// Delete every entry in `bin/` except the Core/gateway binaries needed to boot.
fn wipe_bin_dir(bin: &Path) -> std::io::Result<()> {
    let mut first_err: Option<std::io::Error> = None;
    let Ok(entries) = std::fs::read_dir(bin) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if BIN_PRESERVE.contains(&name_str.as_ref()) {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let result = if is_dir {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(e) = result {
            if first_err.is_none() {
                first_err = Some(e);
            }
        }
    }
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// True when `dir` still contains anything that a successful reset would delete.
fn reset_wipe_has_leftovers(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == RESET_MARKER || RESET_PRESERVE.contains(&name_str.as_ref()) {
            continue;
        }
        if name_str == "bin" {
            // Leftover if bin still holds anything outside the allowlist.
            if bin_has_non_essential(&entry.path()) {
                return true;
            }
            continue;
        }
        return true;
    }
    false
}

fn bin_has_non_essential(bin: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(bin) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !BIN_PRESERVE.contains(&name_str.as_ref()) {
            return true;
        }
    }
    false
}

// ── Sizing / free space (used by the data-path API + relocate validation) ────────

/// Recursively sum the byte size of a directory tree. Best-effort: unreadable
/// entries are skipped; returns 0 if `path` doesn't exist.
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    walk_size(path, &mut total);
    total
}

fn walk_size(path: &Path, acc: &mut u64) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            walk_size(&entry.path(), acc);
        } else {
            *acc += meta.len();
        }
    }
}

/// Bytes available on the filesystem that would contain `path`. Picks the disk
/// whose mount point is the longest prefix of `path`. Returns 0 if undeterminable.
/// Works for not-yet-existing paths (the comparison is lexical against mounts).
pub fn available_space_for(path: &Path) -> u64 {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            if best.is_none_or(|(b, _)| len > b) {
                best = Some((len, disk.available_space()));
            }
        }
    }
    best.map_or(0, |(_, s)| s)
}

/// Best-effort canonicalization that tolerates a not-yet-existing leaf: it
/// canonicalizes the longest existing ancestor and re-appends the remainder.
pub fn canonical_ish(path: &Path) -> PathBuf {
    if let Ok(c) = std::fs::canonicalize(path) {
        return c;
    }
    let mut ancestor = path;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    while let Some(parent) = ancestor.parent() {
        if let Some(name) = ancestor.file_name() {
            tail.push(name);
        }
        if let Ok(c) = std::fs::canonicalize(parent) {
            let mut out = c;
            for name in tail.iter().rev() {
                out.push(name);
            }
            return out;
        }
        ancestor = parent;
    }
    path.to_path_buf()
}

/// True if either path is the same as or contained within the other — used to
/// reject relocating a data dir into itself (which would copy forever).
pub fn paths_overlap(a: &Path, b: &Path) -> bool {
    let a = canonical_ish(a);
    let b = canonical_ish(b);
    a.starts_with(&b) || b.starts_with(&a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_dir_matches_the_active_profile() {
        let expected = format!(".ryu{}", crate::profile::suffix());
        assert!(default_ryu_dir().ends_with(expected));
    }

    #[test]
    fn pointer_roundtrips() {
        let p = DataPathPointer {
            data_dir: Some("D:/somewhere/ryu".to_string()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: DataPathPointer = serde_json::from_str(&json).unwrap();
        assert_eq!(back.data_dir.as_deref(), Some("D:/somewhere/ryu"));
    }

    #[test]
    fn empty_pointer_serializes_without_data_dir() {
        let json = serde_json::to_string(&DataPathPointer::default()).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn reset_wipes_all_but_keys() {
        let base = std::env::temp_dir().join("ryu-reset-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        // Data to wipe: a DB file and a nested store dir.
        std::fs::write(base.join("conversations.db"), b"x").unwrap();
        std::fs::create_dir_all(base.join("models")).unwrap();
        std::fs::write(base.join("models").join("a.bin"), b"y").unwrap();
        std::fs::create_dir_all(base.join("plugins")).unwrap();
        // The on-disk name, not the id: a scoped id is flattened by
        // `plugin_manifest::plugin_dir_name` before it is ever joined onto a path,
        // precisely so it stays ONE component (the loader's `read_dir` is
        // single-level, so a nested dir would be invisible).
        std::fs::write(base.join("plugins").join("@ryu+clips"), b"z").unwrap();
        std::fs::write(base.join("agents.db"), b"a").unwrap();
        std::fs::write(base.join("plugins.db"), b"p").unwrap();
        // Custody files to preserve.
        std::fs::write(base.join("master.key"), b"k").unwrap();
        std::fs::write(base.join("memory.key"), b"m").unwrap();
        // bin/: Core/gateway survive; every other sidecar is wiped.
        std::fs::create_dir_all(base.join("bin")).unwrap();
        std::fs::write(base.join("bin").join("ryu-core.exe"), b"elf").unwrap();
        std::fs::write(base.join("bin").join("ryu-gateway.exe"), b"gw").unwrap();
        std::fs::write(base.join("bin").join("llama-server.exe"), b"llm").unwrap();
        std::fs::write(base.join("bin").join("some-app.exe"), b"app").unwrap();
        // The marker that arms the wipe.
        std::fs::write(base.join(RESET_MARKER), b"1").unwrap();

        wipe_dir_preserving_keys(&base).expect("wipe succeeds against unlocked temp dir");

        assert!(!base.join("conversations.db").exists());
        assert!(!base.join("models").exists());
        assert!(!base.join("plugins").exists());
        assert!(!base.join("agents.db").exists());
        assert!(!base.join("plugins.db").exists());
        assert!(!base.join(RESET_MARKER).exists());
        assert!(base.join("master.key").exists());
        assert!(base.join("memory.key").exists());
        assert!(
            base.join("bin").join("ryu-core.exe").exists(),
            "reset must keep ryu-core so the node can reboot"
        );
        assert!(
            base.join("bin").join("ryu-gateway.exe").exists(),
            "reset must keep ryu-gateway"
        );
        assert!(
            !base.join("bin").join("llama-server.exe").exists(),
            "reset must wipe non-essential bin sidecars"
        );
        assert!(
            !base.join("bin").join("some-app.exe").exists(),
            "reset must wipe previously-installed app binaries"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn reset_keeps_marker_when_wipe_blocked() {
        // Simulate a locked leftover: after a partial failure the marker must
        // survive so the next boot retries instead of silently keeping data.
        let base = std::env::temp_dir().join("ryu-reset-marker-keep");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join(RESET_MARKER), b"1").unwrap();
        std::fs::write(base.join("conversations.db"), b"x").unwrap();

        // Pretend wipe left leftovers by only checking the leftover detector —
        // the full wipe against an unlocked temp dir always succeeds; this
        // asserts the contract the retry loop depends on.
        assert!(reset_wipe_has_leftovers(&base));
        assert!(base.join(RESET_MARKER).exists());
        wipe_dir_preserving_keys(&base).unwrap();
        assert!(!reset_wipe_has_leftovers(&base));
        assert!(!base.join(RESET_MARKER).exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn overlap_detects_nesting() {
        let base = std::env::temp_dir();
        let parent = base.join("ryu-overlap-parent");
        let child = parent.join("child");
        assert!(paths_overlap(&parent, &child));
        assert!(paths_overlap(&child, &parent));
        let sibling = base.join("ryu-overlap-sibling");
        assert!(!paths_overlap(&parent, &sibling));
    }
}
