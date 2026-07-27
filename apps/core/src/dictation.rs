//! Dictation kernel switch — the process-global on/off flag owned by the
//! built-in **Dictation** plugin.
//!
//! The capture → STT → insert pipeline lives in the Island companion (the OS
//! surface). What stays here is the tiny kernel coupling: the process-global
//! "dictation is on" flag. Installing/enabling the Dictation plugin is the
//! *single* switch — Core seeds [`set_enabled`] from the plugin's persisted
//! state at boot (`main.rs`) and flips it live from the plugin enable/disable
//! path (`apply_policy`'s `dictation` arm). There is no separate settings master
//! toggle — the plugin **is** the switch.
//!
//! Enabling also syncs the `dictation` preference blob's `enabled` field so the
//! Island companion's existing preference subscription rebinds shortcuts live.

use std::sync::atomic::{AtomicBool, Ordering};

/// Manifest id of the built-in **Dictation** plugin. Installing/enabling that
/// plugin is the *single* on/off switch for system-wide dictation + agent-ask.
pub const DICTATION_PLUGIN_ID: &str = "dictation";

/// Preference key for the Island dictation settings blob (must match the
/// Island / desktop clients).
pub const DICTATION_PREF_KEY: &str = "dictation";

/// Process-global "dictation is on" flag, owned by the Dictation plugin's
/// enabled state.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Set the dictation enabled flag. Called from boot seeding and the plugin
/// enable/disable path — never inline in a request handler.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

/// Whether system-wide dictation is currently enabled (i.e. the Dictation
/// plugin is installed and enabled).
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_flag_defaults_off_and_toggles() {
        set_enabled(false);
        assert!(!is_enabled());
        set_enabled(true);
        assert!(is_enabled());
        set_enabled(false);
        assert!(!is_enabled());
    }
}
