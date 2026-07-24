// Launch-at-login ("start Ryu on startup") and the start-hidden preference.
//
// The two settings live in different places on purpose:
//
// - *Start at login* is an OS registration performed by tauri-plugin-autostart
//   (macOS LaunchAgent plist, Windows `Run` registry key, Linux
//   `~/.config/autostart/*.desktop`). The OS is the source of truth — the user
//   can revoke it from System Settings / Task Manager without telling us — so
//   the UI seeds its toggle from the plugin's `isEnabled()` rather than from a
//   local mirror we'd have to keep in sync.
// - *Start hidden* is a local desktop preference in the same
//   tauri-plugin-store file the tray pref uses, because it must be readable
//   synchronously during `setup()`, long before Core is guaranteed to be up.
//
// Start-hidden applies only to a login-launched instance. The autostart
// registration passes `--autostart`, so the flag's presence in argv is what
// distinguishes "the OS started us at login" from "the user opened the app". A
// manual launch is therefore always visible, whatever the preference says —
// which also means a mistake here can never leave the user with an app they
// cannot get on screen.

use tauri::{Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::tray::SETTINGS_FILE;

/// Argument the autostart registration passes to the app, marking a
/// login-launched instance. Must stay in sync with the
/// `tauri_plugin_autostart::init(.., Some(vec![AUTOSTART_ARG]))` call in `lib.rs`.
pub const AUTOSTART_ARG: &str = "--autostart";

/// When `true`, a login-launched instance starts with no window on screen
/// (it still runs in the tray / menu bar). Absent/false = window is shown.
const START_HIDDEN_KEY: &str = "start-hidden";

/// Read the persisted "start hidden" preference. Defaults to `false` (shown)
/// whenever the store is missing, unreadable, or the key is unset.
fn read_start_hidden<R: Runtime, M: Manager<R>>(app: &M) -> bool {
    app.store(SETTINGS_FILE)
        .ok()
        .and_then(|store| store.get(START_HIDDEN_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// Was this process started by the OS at login rather than by the user?
fn launched_at_login() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

/// Whether the main window should stay off-screen for this launch.
pub fn should_start_hidden<R: Runtime, M: Manager<R>>(app: &M) -> bool {
    launched_at_login() && read_start_hidden(app)
}

/// Current "start hidden" preference, for the settings UI to seed its toggle.
#[tauri::command]
pub fn get_start_hidden(app: tauri::AppHandle) -> bool {
    read_start_hidden(&app)
}

/// Persist the "start hidden" preference. Takes effect on the next
/// login-launched start; nothing about the running window changes.
#[tauri::command]
pub fn set_start_hidden(app: tauri::AppHandle, hidden: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(START_HIDDEN_KEY, serde_json::json!(hidden));
    store.save().map_err(|e| e.to_string())
}
