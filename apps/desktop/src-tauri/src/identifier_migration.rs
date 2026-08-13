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
//! Two rules make a crash mid-migration harmless:
//!   * **Copy, never move.** The old directory is left untouched, so an
//!     interrupted run leaves the source intact and the next launch retries.
//!     (`bun run wipe --legacy` is how the leftovers get cleaned up.)
//!   * **Never overwrite.** The copy is skipped entirely once the new directory
//!     has any content, so a user who already signed in under the new identifier
//!     can never have that clobbered by a stale file from the old one.
//!
//! What this deliberately does NOT carry:
//!   * Keychain secrets — those are keyed by service `ryu` + account, not by the
//!     bundle identifier, so they survive the rename untouched (`secrets.rs`).
//!   * macOS TCC grants (Accessibility, Screen Recording). Those are bound to the
//!     bundle id *and* the code signature and cannot be migrated by any means;
//!     the user must re-grant them once. This is inherent to renaming, not an
//!     omission here.

use std::path::{Path, PathBuf};

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

/// True when `dir` is absent or holds no entries — the only state into which a
/// migration may write.
fn is_empty_or_absent(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    }
}

/// Decide whether to migrate. Split out from the IO so the policy is testable:
/// migrate only when the legacy directory has content AND the new one does not.
pub fn should_migrate(legacy_exists_with_content: bool, new_is_empty: bool) -> bool {
    legacy_exists_with_content && new_is_empty
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
    if !should_migrate(!is_empty_or_absent(&legacy), is_empty_or_absent(&current)) {
        return 0;
    }

    if let Err(err) = std::fs::create_dir_all(&current) {
        eprintln!("ryu: identifier migration could not create {current:?}: {err}");
        return 0;
    }

    let Ok(entries) = std::fs::read_dir(&legacy) else {
        return 0;
    };
    let mut copied = 0;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = current.join(entry.file_name());
        // Only the plugin-store files live at this level; a nested directory is
        // a cache we have no reason to carry, so shallow-copy is correct.
        if from.is_dir() {
            continue;
        }
        match std::fs::copy(&from, &to) {
            Ok(_) => copied += 1,
            Err(err) => eprintln!("ryu: identifier migration could not copy {from:?}: {err}"),
        }
    }
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
    fn migrates_only_when_the_legacy_dir_has_content_and_the_new_one_does_not() {
        // The one state that may be written into.
        assert!(should_migrate(true, true));
        // Already signed in under the new id — never clobber it.
        assert!(!should_migrate(true, false));
        // Fresh install, nothing to carry.
        assert!(!should_migrate(false, true));
        assert!(!should_migrate(false, false));
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
