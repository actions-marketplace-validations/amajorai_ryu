use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Runtime,
};
use tauri_plugin_store::StoreExt;

/// Stable id so the tray handle can be looked up again after creation to toggle
/// its visibility at runtime (see `set_hide_tray_icon`).
const TRAY_ID: &str = "main";
/// Local desktop-process settings file (tauri-plugin-store). Read synchronously
/// at startup before Core is guaranteed to be up, so the tray pref lives here
/// rather than in Core's `/api/preferences` KV.
pub(crate) const SETTINGS_FILE: &str = "settings.json";
/// When `true`, the tray / menu bar icon is hidden. Absent/false = shown.
const HIDE_TRAY_KEY: &str = "hide-tray-icon";
/// When `true`, closing the main window hides it to the tray instead of quitting.
/// Absent = `true`: this is a background assistant with a menu-bar presence, and
/// the alternative (closing the window kills Core and every running turn with it)
/// is what a user closing a window almost never means.
const CLOSE_TO_TRAY_KEY: &str = "close-to-tray";

/// Set once a real quit is under way, so the close-to-tray interception knows to
/// let this one through. Without it, "stay in tray" would swallow the tray's own
/// Quit and the app could only be killed from Activity Monitor.
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Mark a real quit as in progress (tray Quit, app-menu Quit, `quit_app`).
pub(crate) fn begin_quit() {
    QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// True once [`begin_quit`] has run.
pub(crate) fn is_quitting() -> bool {
    QUITTING.load(std::sync::atomic::Ordering::SeqCst)
}

/// Loopback control server the Electron island exposes (see
/// `island/src/main/control.ts`). The island has no tray of its own anymore — the
/// menu-bar presence is unified here — so we drive its window + lifecycle through
/// this surface. The port is profile-aware (dev variant → 8989) and honours an
/// explicit `ISLAND_CONTROL_PORT` env override, matching the island side.
fn island_control_url() -> String {
    format!(
        "http://127.0.0.1:{}/control",
        crate::profile::island_control_port()
    )
}

/// Shadow capture-control endpoint (device-bound local sidecar). Toggling capture
/// is a Shadow concern, so the desktop tray talks to it directly rather than
/// proxying through the island. Profile-aware port (release 3030, dev 4030),
/// matching Core's spawn side; the request carries Shadow's shared-secret
/// bearer (see `shadow_auth`) because every non-`/health` route is gated.
fn shadow_capture_url() -> String {
    format!(
        "http://127.0.0.1:{}/capture/control",
        crate::profile::port(3030)
    )
}

/// Local sidecars answer fast or not at all; keep tray actions snappy.
const CONTROL_TIMEOUT_SECS: u64 = 2;

fn control_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CONTROL_TIMEOUT_SECS))
        .build()
        .ok()
}

/// Bring the main window forward (creating focus) before running a webview action.
fn focus_main<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Send a control action ("toggle" | "show" | "hide" | "quit") to the island
/// and return the visibility reported by Island. Best-effort: the island may not
/// be running, in which case callers receive `None`.
async fn island_control(action: &'static str) -> Option<bool> {
    let Some(client) = control_client() else {
        return None;
    };
    let response = client
        .post(island_control_url())
        .json(&serde_json::json!({ "action": action }))
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()?;
    response.get("visible").and_then(|value| value.as_bool())
}

/// Read the device-local Island window state for a future desktop visibility
/// control. `None` means Island is not running or is not reachable.
#[tauri::command]
pub async fn get_island_visibility() -> Option<bool> {
    let client = control_client()?;
    client
        .get(island_control_url())
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()?
        .get("visible")
        .and_then(|value| value.as_bool())
}

/// Show or hide the device-local Island window. This command is wired now so the
/// future User Nav control only needs to be uncommented when Island is enabled.
#[tauri::command]
pub async fn set_island_visibility(visible: bool) -> Option<bool> {
    island_control(if visible { "show" } else { "hide" }).await
}

/// Flip Shadow's capture pause state and return the new `paused` value (or `None`
/// when Shadow is unreachable / the response is malformed).
async fn toggle_shadow_capture() -> Option<bool> {
    let client = control_client()?;
    let url = shadow_capture_url();
    let current = crate::shadow_auth::with_auth(client.get(&url))
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()?;
    let paused = current
        .get("paused")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let next = !paused;
    let updated = crate::shadow_auth::with_auth(client.post(&url))
        .json(&serde_json::json!({ "paused": next }))
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()?;
    Some(
        updated
            .get("paused")
            .and_then(|v| v.as_bool())
            .unwrap_or(next),
    )
}

/// Read the persisted "hide tray icon" preference. Defaults to `false` (shown)
/// whenever the store is missing, unreadable, or the key is unset.
pub(crate) fn read_hide_tray<R: Runtime, M: Manager<R>>(app: &M) -> bool {
    app.store(SETTINGS_FILE)
        .ok()
        .and_then(|store| store.get(HIDE_TRAY_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// Read the persisted "keep running in the tray when the window is closed"
/// preference. Defaults to `true` — see [`CLOSE_TO_TRAY_KEY`].
///
/// Reported as `false` whenever the tray icon is hidden, no matter what is
/// stored. Hiding to a tray that is not drawn leaves a running app with no
/// window and no icon: on Windows and Linux the only way back is the
/// single-instance path, and on macOS a Dock click (`RunEvent::Reopen`) — which
/// is exactly the trap `lib.rs` already documents. The two settings are
/// independent controls, so rather than forbid the combination we make the
/// dangerous half inert while the other is on.
pub(crate) fn read_close_to_tray<R: Runtime, M: Manager<R>>(app: &M) -> bool {
    if read_hide_tray(app) {
        return false;
    }
    app.store(SETTINGS_FILE)
        .ok()
        .and_then(|store| store.get(CLOSE_TO_TRAY_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

pub fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Ryu", true, None::<&str>)?;
    // # 0.1.0: Island disabled — uncomment when re-enabling the companion tray item
    // The island (companion overlay) and its capture pipeline are driven from here
    // now that the island has no menu-bar icon of its own.
    // let companion = MenuItem::with_id(app, "companion", "Show/Hide Companion", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Pause Capture", true, None::<&str>)?;
    let timeline = MenuItem::with_id(app, "timeline", "Open Timeline", true, None::<&str>)?;
    let palette = MenuItem::with_id(app, "palette", "Search Everything…", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            // # 0.1.0: Island disabled — restore `&companion,` after `&sep1,`
            &show, &sep1, /* &companion, */ &capture, &sep2, &timeline, &palette, &sep3, &quit,
        ],
    )?;

    // On macOS the menu bar recolors a "template" image automatically for the
    // active light/dark appearance, using only its alpha channel. We rasterize
    // the transparent ghost SVG to `tray-template.png` and hand it over as a
    // template so it tracks the system theme. On Windows/Linux template recolor
    // does not exist and a transparent ghost would be near-invisible on a light
    // taskbar, so we keep the self-contained app icon there.
    let is_mac = cfg!(target_os = "macos");
    let tray_icon = if is_mac {
        Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
    } else {
        app.default_window_icon().unwrap().clone()
    };

    // Held so the "capture" item's label can flip between Pause/Resume after a
    // toggle round-trips to Shadow. Cloned into the menu-event closure below.
    let capture_item = capture.clone();

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .icon_as_template(is_mac)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                focus_main(app);
            }
            // # 0.1.0: Island disabled — uncomment when re-enabling Show/Hide Companion
            // // Toggle the Electron island overlay via its loopback control server.
            // "companion" => {
            // 	tauri::async_runtime::spawn(island_control("toggle"));
            // }
            // Pause/resume Shadow capture, then reflect the new state in the label.
            "capture" => {
                let item = capture_item.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(paused) = toggle_shadow_capture().await {
                        let label = if paused {
                            "Resume Capture"
                        } else {
                            "Pause Capture"
                        };
                        let _ = item.set_text(label);
                    }
                });
            }
            // Bring the window forward, then ask the webview to open the timeline
            // tab / command palette (mirrors the `nodes-changed` event pattern).
            "timeline" => {
                focus_main(app);
                let _ = app.emit("tray-open-timeline", ());
            }
            "palette" => {
                focus_main(app);
                let _ = app.emit("tray-open-palette", ());
            }
            // Stop the companion island too, then exit — the unified tray owns both
            // lifecycles, and the island has no other quit affordance.
            "quit" => {
                // Flag the quit BEFORE it starts: with close-to-tray on, the window's
                // CloseRequested handler would otherwise cancel the very shutdown this
                // item exists to perform.
                begin_quit();
                // Stop the backend explicitly. With close-to-tray on, the window is
                // never destroyed, so `WindowEvent::Destroyed` — the arm that used to
                // own this — does not fire on the way out.
                crate::stop_managed_core(app);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = island_control("quit").await;
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    // Honor the persisted preference: start hidden if the user disabled the
    // tray. Built-then-hidden (rather than skipped) keeps a single code path so
    // the runtime toggle just flips visibility on the retained handle.
    if read_hide_tray(app) {
        let _ = tray.set_visible(false);
    }

    Ok(())
}

/// Current "hide tray icon" preference, for the settings UI to seed its toggle.
#[tauri::command]
pub fn get_hide_tray_icon(app: tauri::AppHandle) -> bool {
    read_hide_tray(&app)
}

/// Persist the "hide tray icon" preference and apply it to the live tray icon
/// immediately. `hidden = true` removes the icon from the tray / menu bar.
#[tauri::command]
pub fn set_hide_tray_icon(app: tauri::AppHandle, hidden: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(HIDE_TRAY_KEY, serde_json::json!(hidden));
    store.save().map_err(|e| e.to_string())?;

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(!hidden).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Current "keep running in the tray on close" preference, for the settings UI
/// and onboarding to seed their toggle.
#[tauri::command]
pub fn get_close_to_tray(app: tauri::AppHandle) -> bool {
    read_close_to_tray(&app)
}

/// Persist the "keep running in the tray on close" preference. Takes effect on
/// the next close; there is nothing live to reconfigure.
#[tauri::command]
pub fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(CLOSE_TO_TRAY_KEY, serde_json::json!(enabled));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
