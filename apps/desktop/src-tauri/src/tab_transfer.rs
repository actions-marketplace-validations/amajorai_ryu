//! Ephemeral renderer-ready handshake for tab moves. A native window existing
//! is not proof that its renderer loaded; keep the source until acknowledgement.
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::Manager;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct TabTransfers(Mutex<HashMap<String, oneshot::Sender<()>>>);

/// Any error after allocating a destination releases it as well as its waiter.
pub struct TransferWindowGuard {
    window: tauri::WebviewWindow,
    committed: bool,
}

impl TransferWindowGuard {
    pub fn new(window: &tauri::WebviewWindow) -> Self {
        Self {
            window: window.clone(),
            committed: false,
        }
    }

    pub fn commit(&mut self) {
        self.committed = true;
    }
}

impl Drop for TransferWindowGuard {
    fn drop(&mut self) {
        self.window
            .state::<TabTransfers>()
            .remove(self.window.label());
        if !self.committed {
            let _ = self.window.close();
        }
    }
}

impl TabTransfers {
    pub fn begin(&self, label: &str) -> Result<oneshot::Receiver<()>, String> {
        let (sender, receiver) = oneshot::channel();
        self.0
            .lock()
            .map_err(|_| "tab transfer lock poisoned")?
            .insert(label.to_owned(), sender);
        Ok(receiver)
    }

    pub fn remove(&self, label: &str) {
        if let Ok(mut pending) = self.0.lock() {
            pending.remove(label);
        }
    }

    fn ready(&self, label: &str) -> Result<(), String> {
        if let Some(sender) = self
            .0
            .lock()
            .map_err(|_| "tab transfer lock poisoned")?
            .remove(label)
        {
            let _ = sender.send(());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn tab_transfer_ready(
    window: tauri::WebviewWindow,
    transfers: tauri::State<'_, TabTransfers>,
) -> Result<(), String> {
    // The injected calling window supplies the label, never the caller's JSON.
    transfers.ready(window.label())
}

pub async fn wait_for_renderer(
    window: &tauri::WebviewWindow,
    receiver: oneshot::Receiver<()>,
) -> Result<(), String> {
    let result = tokio::time::timeout(Duration::from_secs(30), receiver).await;
    window.state::<TabTransfers>().remove(window.label());
    if !matches!(result, Ok(Ok(()))) {
        let _ = window.close();
        return Err(
            "The new window did not become ready. Your tab is still in its original window.".into(),
        );
    }
    Ok(())
}

pub fn initialization_script(transfer: &serde_json::Value) -> Result<String, String> {
    if transfer.get("version").and_then(|v| v.as_u64()) != Some(1)
        || transfer
            .pointer("/tab/id")
            .and_then(|v| v.as_str())
            .map_or(true, str::is_empty)
        || !transfer
            .pointer("/tab/path")
            .and_then(|v| v.as_str())
            .is_some_and(|p| p.starts_with('/') && !p.starts_with("//"))
    {
        return Err("Invalid tab transfer".into());
    }
    let json = serde_json::to_string(transfer).map_err(|e| e.to_string())?;
    if json.len() > 16 * 1024 * 1024 {
        return Err("This tab's unsaved content is too large to move into another window.".into());
    }
    // JSON inside a JSON string is data, including __proto__ and script text.
    let quoted = serde_json::to_string(&json).map_err(|e| e.to_string())?;
    Ok(format!(
        "if (window === window.top) {{ window.__RYU_TAB_TRANSFER__ = JSON.parse({quoted}); }}"
    ))
}

pub fn outside_window(
    window: &tauri::WebviewWindow,
) -> Result<Option<tauri::PhysicalPosition<i32>>, String> {
    // During an Escape-cancelled native drag, webviews may never receive the
    // keydown. The button is still pressed when dragend reaches JavaScript.
    if matches!(native_drag_state(), Some((true, _)) | Some((_, true))) {
        return Ok(None);
    }
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let margin = 12.0 * window.scale_factor().map_err(|e| e.to_string())?;
    if point_is_outside(
        cursor.x,
        cursor.y,
        origin.x as f64,
        origin.y as f64,
        size.width as f64,
        size.height as f64,
        margin,
    ) {
        return Ok(Some(tauri::PhysicalPosition::new(
            cursor.x as i32,
            cursor.y as i32,
        )));
    }
    Ok(None)
}

/// Some WebKit native drags leave the source without a DOM dragend. Observe
/// release without intercepting the OS drag, so the renderer can clear that
/// session and tear it out if the release was outside. A normal DOM drop wins.
#[tauri::command]
pub async fn watch_tab_drag(window: tauri::WebviewWindow) -> Result<Option<bool>, String> {
    for _ in 0..3000 {
        match native_drag_state() {
            None => return Ok(None),
            Some((_, true)) => return Ok(Some(false)),
            Some((false, false)) => {
                return outside_window(&window).map(|position| Some(position.is_some()))
            }
            Some((true, false)) => {}
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
        if window
            .app_handle()
            .get_webview_window(window.label())
            .is_none()
        {
            return Ok(None);
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn native_drag_state() -> Option<(bool, bool)> {
    {
        extern "C" {
            fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
            fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
        }
        Some(unsafe { (CGEventSourceButtonState(0, 0), CGEventSourceKeyState(0, 53)) })
    }
}

#[cfg(target_os = "windows")]
fn native_drag_state() -> Option<(bool, bool)> {
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(key: i32) -> i16;
        }
        Some(unsafe { (GetAsyncKeyState(0x01) < 0, GetAsyncKeyState(0x1b) < 0) })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn native_drag_state() -> Option<(bool, bool)> {
    None
}

pub fn position_at_drop(window: &tauri::WebviewWindow, cursor: tauri::PhysicalPosition<i32>) {
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let Some(monitor) = monitors.into_iter().find(|monitor| {
        !point_is_outside(
            cursor.x as f64,
            cursor.y as f64,
            monitor.position().x as f64,
            monitor.position().y as f64,
            monitor.size().width as f64,
            monitor.size().height as f64,
            0.0,
        )
    }) else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let size = tauri::LogicalSize::new(1100.0, 780.0).to_physical::<u32>(scale);
    let position = tauri::PhysicalPosition::new(
        clamp_coordinate(
            cursor.x - (120.0 * scale) as i32,
            area.position.x,
            area.size.width,
            size.width,
        ),
        clamp_coordinate(
            cursor.y - (20.0 * scale) as i32,
            area.position.y,
            area.size.height,
            size.height,
        ),
    );
    let _ = window.set_position(position);
}

fn clamp_coordinate(value: i32, origin: i32, extent: u32, window_extent: u32) -> i32 {
    let maximum = origin.saturating_add(extent.saturating_sub(window_extent) as i32);
    value.clamp(origin, maximum)
}

fn point_is_outside(
    x: f64,
    y: f64,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    margin: f64,
) -> bool {
    x < left - margin || y < top - margin || x > left + width + margin || y > top + height + margin
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn only_the_destination_can_acknowledge_and_repeated_ack_is_harmless() {
        let transfers = TabTransfers::default();
        let mut receiver = transfers.begin("tab-1").unwrap();
        transfers.ready("main").unwrap();
        assert_eq!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        );
        transfers.ready("tab-1").unwrap();
        receiver.await.unwrap();
        transfers.ready("tab-1").unwrap();
    }

    #[tokio::test]
    async fn cancelling_a_transfer_releases_its_waiter() {
        let transfers = TabTransfers::default();
        let receiver = transfers.begin("tab-1").unwrap();
        transfers.remove("tab-1");
        assert!(receiver.await.is_err());
    }

    #[test]
    fn transfer_requires_version_and_internal_tab_path() {
        assert!(initialization_script(&serde_json::json!({"version": 2})).is_err());
        assert!(initialization_script(
            &serde_json::json!({"version": 1, "tab": {"id": "x", "path": "//evil.test"}})
        )
        .is_err());
        let value = serde_json::json!({"version": 1, "tab": {"id": "x", "path": "/chat", "initialPrompt": "</script>\n'quoted'"}});
        assert!(initialization_script(&value)
            .unwrap()
            .contains("JSON.parse("));
    }

    #[test]
    fn geometry_handles_negative_monitor_coordinates_and_edge_slop() {
        assert!(!point_is_outside(
            -500.0, 20.0, -1200.0, 0.0, 1000.0, 800.0, 12.0
        ));
        assert!(!point_is_outside(
            -190.0, 20.0, -1200.0, 0.0, 1000.0, 800.0, 12.0
        ));
        assert!(point_is_outside(
            -170.0, 20.0, -1200.0, 0.0, 1000.0, 800.0, 12.0
        ));
        assert_eq!(clamp_coordinate(1800, 0, 1920, 1100), 820);
        assert_eq!(clamp_coordinate(-1900, -1920, 1920, 1100), -1900);
        assert_eq!(clamp_coordinate(600, 0, 800, 1100), 0);
    }
}
