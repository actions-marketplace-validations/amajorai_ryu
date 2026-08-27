//! One-time carry-over of the desktop's app-data store across the 2026-08 bundle
//! identifier rename (`dev.ryu.desktop` → `ai.amajor.ryu.desktop`).
//!
//! The bundle identifier keys the OS app-data directory, and `tauri-plugin-store`
//! writes `auth.bin`, `companion.bin`, `entitlement.bin` and `settings.json`
//! there. Renaming the identifier therefore points a freshly-updated install at
//! an empty directory: the user is silently signed out and their cached licence
//! entitlement disappears. This module copies the old directory's contents into
//! the new one exactly once, so an update is invisible to them.
//!
//! **This runs before `tauri::Builder`**, not in `setup`. The identifier is a
//! compile-time constant and every OS derives the app-data dir as
//! `<data-root>/<identifier>` (macOS `~/Library/Application Support`, Windows
//! `%APPDATA%`, Linux `$XDG_DATA_HOME`), so both paths resolve from `dirs`
//! without an `AppHandle`. Doing it here removes the race against the webview,
//! which starts loading — and can call `load("auth.bin")` — while `setup` is
//! still running.
//!
//! Three rules make a crash mid-migration harmless:
//!   * **Copy, never move.** The old directory is left untouched, so an
//!     interrupted run leaves the source intact and the next launch retries.
//!     (`bun run wipe --legacy` is how the leftovers get cleaned up.)
//!   * **Never overwrite.** The copy is skipped entirely once the new directory
//!     already has the same file, so a newer sign-in can never be clobbered.
//!   * **Mark only complete passes.** Missing files are retried until every legacy
//!     entry is present; a partial destination is not mistaken for success.
//!
//! What this deliberately does NOT carry:
//!   * Keychain secrets — those are keyed by service `ryu` + account, not by the
//!     bundle identifier, so they survive the rename untouched (`secrets.rs`).
//!   * macOS TCC grants (Accessibility, Screen Recording). Those are bound to the
//!     bundle id *and* the code signature and cannot be migrated by any means;
//!     the user must re-grant them once. This is inherent to renaming, not an
//!     omission here.

use std::path::{Path, PathBuf};

const MIGRATION_COMPLETE_MARKER: &str = ".identifier-migration-complete";

/// The pre-rename release identifier. Kept as a constant (not derived) because
/// it is frozen history — it must never track a future rename.
pub const LEGACY_RELEASE_IDENTIFIER: &str = "dev.ryu.desktop";

/// The pre-rename dev-variant identifier (`tauri.dev.conf.json`).
pub const LEGACY_DEV_IDENTIFIER: &str = "dev.ryu.desktop.dev";

/// True when this bundle carries the `.dev` identifier — i.e. it was built from
/// `tauri.dev.conf.json`, or is a local `RYU_PROFILE=dev` run of the same tree.
///
/// Deliberately NOT `!profile::is_release()`. The identifier is stamped into the
/// bundle at BUILD time and only two configs exist, so it does not track the
/// profile: a canary/nightly build activates the `canary`/`nightly` profile (see
/// `profile::profile_for_version`) while still shipping the RELEASE identifier —
/// the release CI declines to touch `identifier`. Keying on the profile would
/// point such a build's migration at `ai.amajor.ryu.desktop.dev`, a directory it
/// never reads, and skip the one it does.
fn uses_dev_identifier() -> bool {
    cfg!(feature = "dev-variant") || crate::profile::name() == "dev"
}

/// The current identifier for this bundle, mirroring the two Tauri configs.
/// Asserted against them by `identifiers_match_the_tauri_configs`.
pub fn current_identifier() -> &'static str {
    if uses_dev_identifier() {
        "ai.amajor.ryu.desktop.dev"
    } else {
        "ai.amajor.ryu.desktop"
    }
}

/// The pre-rename identifier for this bundle.
pub fn legacy_identifier() -> &'static str {
    if uses_dev_identifier() {
        LEGACY_DEV_IDENTIFIER
    } else {
        LEGACY_RELEASE_IDENTIFIER
    }
}

/// `<data-root>/<identifier>` — the same directory Tauri's `app_data_dir()`
/// resolves, derived without an `AppHandle` so this can run before the builder.
fn app_data_dir_for(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|root| root.join(identifier))
}

/// Decide whether to migrate. Split out from the IO so the policy is testable:
/// migrate only when the legacy directory has content and no completed pass was
/// recorded. A nonempty destination may be a partial copy and must be retried.
pub fn should_migrate(legacy_exists_with_content: bool, migration_complete: bool) -> bool {
    legacy_exists_with_content && !migration_complete
}

fn migration_marker(dir: &Path) -> PathBuf {
    dir.join(MIGRATION_COMPLETE_MARKER)
}

fn copy_without_overwrite(from: &Path, to: &Path, nonce: u128) -> std::io::Result<bool> {
    if to.exists() {
        return Ok(false);
    }
    let temp = to.with_file_name(format!(
        ".ryu-identifier-migration-{}-{nonce}.tmp",
        std::process::id()
    ));
    std::fs::copy(from, &temp)?;
    match std::fs::rename(&temp, to) {
        Ok(()) => Ok(true),
        Err(_) if to.exists() => {
            let _ = std::fs::remove_file(temp);
            Ok(false)
        }
        Err(error) => {
            let _ = std::fs::remove_file(temp);
            Err(error)
        }
    }
}

fn migrate_between(legacy: &Path, current: &Path) -> Result<usize, String> {
    if migration_marker(current).is_file() {
        return Ok(0);
    }
    std::fs::create_dir_all(current)
        .map_err(|error| format!("could not create {current:?}: {error}"))?;
    let entries =
        std::fs::read_dir(legacy).map_err(|error| format!("could not read {legacy:?}: {error}"))?;
    let mut copied = 0;
    for (index, entry) in entries.enumerate() {
        let entry = entry.map_err(|error| format!("could not read legacy entry: {error}"))?;
        let from = entry.path();
        if entry
            .file_type()
            .map_err(|error| format!("could not inspect {from:?}: {error}"))?
            .is_dir()
        {
            continue;
        }
        let to = current.join(entry.file_name());
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
            .saturating_add(index as u128);
        if copy_without_overwrite(&from, &to, nonce)
            .map_err(|error| format!("could not copy {from:?}: {error}"))?
        {
            copied += 1;
        }
    }
    let marker = migration_marker(current);
    let marker_temp = current.join(format!(
        ".ryu-identifier-migration-marker-{}.tmp",
        std::process::id()
    ));
    std::fs::write(&marker_temp, b"complete\n")
        .map_err(|error| format!("could not stage identifier migration marker: {error}"))?;
    std::fs::rename(&marker_temp, marker)
        .map_err(|error| format!("could not mark identifier migration complete: {error}"))?;
    Ok(copied)
}

/// Copy the app-data store from the pre-rename identifier to the current one,
/// once. A no-op on every launch after the first (and on a fresh install).
///
/// Returns the number of entries copied. Failures are reported but never fatal:
/// a user who cannot be migrated must still get a working app, just signed out.
pub fn migrate_app_data() -> usize {
    let (Some(legacy), Some(current)) = (
        app_data_dir_for(legacy_identifier()),
        app_data_dir_for(current_identifier()),
    ) else {
        return 0;
    };
    if legacy == current {
        return 0;
    }
    let legacy_has_content = std::fs::read_dir(&legacy)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some();
    if !should_migrate(legacy_has_content, migration_marker(&current).is_file()) {
        return 0;
    }
    let copied = match migrate_between(&legacy, &current) {
        Ok(copied) => copied,
        Err(error) => {
            eprintln!("ryu: identifier migration incomplete: {error}");
            return 0;
        }
    };
    if copied > 0 {
        eprintln!(
            "ryu: migrated {copied} file(s) from the previous bundle id ({}) to {}. \
             The old folder is left in place — `bun run wipe --legacy` clears it.",
            legacy_identifier(),
            current_identifier()
        );
    }
    copied
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_only_when_legacy_content_has_not_completed() {
        assert!(should_migrate(true, false));
        assert!(!should_migrate(true, true));
        // Fresh install, nothing to carry.
        assert!(!should_migrate(false, false));
        assert!(!should_migrate(false, true));
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("ryu-identifier-{name}-{}", std::process::id()))
    }

    #[test]
    fn retries_a_partial_copy_without_overwriting_newer_files() {
        let container = test_root("partial");
        let legacy = container.join("legacy");
        let current = container.join("current");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(legacy.join("auth.bin"), b"legacy-auth").unwrap();
        std::fs::write(legacy.join("entitlement.bin"), b"legacy-entitlement").unwrap();
        std::fs::write(current.join("auth.bin"), b"newer-auth").unwrap();

        assert_eq!(migrate_between(&legacy, &current).unwrap(), 1);
        assert_eq!(
            std::fs::read(current.join("auth.bin")).unwrap(),
            b"newer-auth"
        );
        assert_eq!(
            std::fs::read(current.join("entitlement.bin")).unwrap(),
            b"legacy-entitlement"
        );
        assert!(migration_marker(&current).is_file());
        assert_eq!(migrate_between(&legacy, &current).unwrap(), 0);
        std::fs::remove_dir_all(container).unwrap();
    }

    #[test]
    fn the_legacy_identifiers_are_frozen_history() {
        // These name directories already on users' disks. A future rename must
        // add a new constant, never edit these.
        assert_eq!(LEGACY_RELEASE_IDENTIFIER, "dev.ryu.desktop");
        assert_eq!(LEGACY_DEV_IDENTIFIER, "dev.ryu.desktop.dev");
    }

    #[test]
    fn identifiers_match_the_tauri_configs() {
        // The identifier lives in JSON that Rust never reads, so drift between
        // the config and this module would silently migrate into a directory the
        // app does not use. Parse both configs and assert agreement.
        let release: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let dev: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.dev.conf.json")).unwrap();
        assert_eq!(release["identifier"], "ai.amajor.ryu.desktop");
        assert_eq!(dev["identifier"], "ai.amajor.ryu.desktop.dev");
        // And the dev id must remain the release id plus the profile suffix, so
        // the two configs can never drift apart.
        assert_eq!(
            format!("{}.dev", release["identifier"].as_str().unwrap()),
            dev["identifier"].as_str().unwrap()
        );
    }

    #[test]
    fn every_identifier_is_distinct_from_its_legacy_form() {
        assert_ne!(LEGACY_RELEASE_IDENTIFIER, "ai.amajor.ryu.desktop");
        assert_ne!(LEGACY_DEV_IDENTIFIER, "ai.amajor.ryu.desktop.dev");
    }
}
