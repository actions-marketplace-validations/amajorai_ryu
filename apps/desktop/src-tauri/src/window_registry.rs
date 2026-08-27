use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// Targeted renderer event used after the native window has been focused.
pub const ACTIVATE_ENTITY_EVENT: &str = "ryu:activate-entity";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowTabRegistration {
    pub active: bool,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RouteEntityAction {
    CreateCurrent,
    Current,
    Focused,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntityResult {
    pub action: RouteEntityAction,
    pub window_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivateEntityPayload {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
}

/// Process-local ownership index for entities currently rendered by desktop
/// windows. The index is deliberately not persisted: a window that disappears
/// is removed by the native Destroyed event, and renderers re-register their
/// current tab snapshot on every meaningful change.
#[derive(Default)]
pub struct WindowRegistry {
    inner: Mutex<RegistryInner>,
}

#[derive(Default)]
struct RegistryInner {
    claims: HashMap<String, HashMap<String, EntityClaim>>,
    clock: u64,
    windows: HashMap<String, WindowRecord>,
}

#[derive(Debug, Clone)]
struct EntityClaim {
    last_seen: u64,
}

#[derive(Debug)]
struct WindowRecord {
    keys: HashSet<String>,
    last_focus: u64,
    renderer_id: String,
    revision: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum RouteDecision {
    CreateCurrent,
    Current,
    Other(String),
}

impl WindowRegistry {
    /// Replace one window's snapshot atomically. Renderer calls can resolve out
    /// of order, so an older revision is ignored rather than resurrecting a tab
    /// that has already been closed or navigated away from.
    pub fn register(
        &self,
        label: &str,
        renderer_id: &str,
        revision: u64,
        tabs: Vec<WindowTabRegistration>,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "window registry lock poisoned".to_string())?;
        inner.register(label, renderer_id, revision, tabs);
        Ok(())
    }

    pub fn touch_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.touch_window(label);
        }
    }

    pub fn remove_window(&self, label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.remove_window(label);
        }
    }

    /// Route a normal entity open. The caller must release the registry lock
    /// before it performs native window operations, so this returns only the
    /// selected destination label.
    fn decide(&self, key: &str, current_label: &str) -> Result<RouteDecision, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "window registry lock poisoned".to_string())?;
        Ok(inner.decide(key, current_label))
    }
}

impl RegistryInner {
    fn register(
        &mut self,
        label: &str,
        renderer_id: &str,
        revision: u64,
        tabs: Vec<WindowTabRegistration>,
    ) {
        if self
            .windows
            .get(label)
            .is_some_and(|record| record.renderer_id == renderer_id && revision < record.revision)
        {
            return;
        }

        let previous = self.windows.remove(label);
        if let Some(previous) = previous.as_ref() {
            for key in &previous.keys {
                self.remove_claim(label, key);
            }
        }

        self.clock = self.clock.saturating_add(1);
        let snapshot_tick = self.clock;
        let mut keys = HashSet::new();
        let mut last_focus = previous
            .as_ref()
            .map_or(snapshot_tick, |record| record.last_focus);

        for tab in tabs {
            if tab.key.is_empty() || !keys.insert(tab.key.clone()) {
                continue;
            }
            self.claims.entry(tab.key).or_default().insert(
                label.to_string(),
                EntityClaim {
                    last_seen: snapshot_tick,
                },
            );
            if tab.active {
                last_focus = snapshot_tick;
            }
        }

        self.windows.insert(
            label.to_string(),
            WindowRecord {
                keys,
                last_focus,
                renderer_id: renderer_id.to_string(),
                revision,
            },
        );
    }

    fn touch_window(&mut self, label: &str) {
        let Some(keys) = self.windows.get(label).map(|record| record.keys.clone()) else {
            return;
        };
        self.clock = self.clock.saturating_add(1);
        let tick = self.clock;
        if let Some(record) = self.windows.get_mut(label) {
            record.last_focus = tick;
        }
        for key in keys {
            if let Some(claims) = self.claims.get_mut(&key) {
                if let Some(claim) = claims.get_mut(label) {
                    claim.last_seen = tick;
                }
            }
        }
    }

    fn remove_window(&mut self, label: &str) {
        let Some(record) = self.windows.remove(label) else {
            return;
        };
        for key in record.keys {
            self.remove_claim(label, &key);
        }
    }

    fn remove_claim(&mut self, label: &str, key: &str) {
        let mut empty = false;
        if let Some(claims) = self.claims.get_mut(key) {
            claims.remove(label);
            empty = claims.is_empty();
        }
        if empty {
            self.claims.remove(key);
        }
    }

    fn decide(&mut self, key: &str, current_label: &str) -> RouteDecision {
        let Some(claims) = self.claims.get(key) else {
            return RouteDecision::CreateCurrent;
        };
        if claims.contains_key(current_label) {
            return RouteDecision::Current;
        }

        claims
            .iter()
            .filter(|(label, _)| self.windows.contains_key(*label))
            .max_by_key(|(label, claim)| {
                (
                    claim.last_seen,
                    self.windows
                        .get(*label)
                        .map_or(0, |record| record.last_focus),
                )
            })
            .map_or(RouteDecision::CreateCurrent, |(label, _)| {
                RouteDecision::Other(label.clone())
            })
    }
}

#[tauri::command]
pub fn register_window_tabs(
    window: tauri::WebviewWindow,
    registry: tauri::State<'_, WindowRegistry>,
    renderer_id: String,
    revision: u64,
    tabs: Vec<WindowTabRegistration>,
) -> Result<(), String> {
    if renderer_id.is_empty() {
        return Err("renderer id cannot be empty".to_string());
    }
    registry.register(window.label(), &renderer_id, revision, tabs)
}

#[tauri::command]
pub fn route_entity_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    registry: tauri::State<'_, WindowRegistry>,
    key: String,
    message_id: Option<String>,
) -> Result<RouteEntityResult, String> {
    if key.is_empty() {
        return Err("entity key cannot be empty".to_string());
    }

    // A destroyed window can race the registry event. Retry once after pruning
    // a stale target so a normal sidebar click falls back to the current window
    // instead of failing visibly.
    for _ in 0..2 {
        match registry.decide(&key, window.label())? {
            RouteDecision::CreateCurrent => {
                return Ok(RouteEntityResult {
                    action: RouteEntityAction::CreateCurrent,
                    window_label: None,
                });
            }
            RouteDecision::Current => {
                return Ok(RouteEntityResult {
                    action: RouteEntityAction::Current,
                    window_label: Some(window.label().to_string()),
                });
            }
            RouteDecision::Other(label) => {
                let Some(target) = app.get_webview_window(&label) else {
                    registry.remove_window(&label);
                    continue;
                };
                target.show().map_err(|error| error.to_string())?;
                target.unminimize().map_err(|error| error.to_string())?;
                target.set_focus().map_err(|error| error.to_string())?;
                target
                    .emit(
                        ACTIVATE_ENTITY_EVENT,
                        ActivateEntityPayload {
                            key: key.clone(),
                            message_id: message_id.clone(),
                        },
                    )
                    .map_err(|error| error.to_string())?;
                return Ok(RouteEntityResult {
                    action: RouteEntityAction::Focused,
                    window_label: Some(label),
                });
            }
        }
    }

    Ok(RouteEntityResult {
        action: RouteEntityAction::CreateCurrent,
        window_label: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(key: &str, active: bool) -> WindowTabRegistration {
        WindowTabRegistration {
            active,
            key: key.to_string(),
        }
    }

    #[test]
    fn activation_payload_carries_a_target_message() {
        let payload = ActivateEntityPayload {
            key: "conversation:a".to_string(),
            message_id: Some("message-42".to_string()),
        };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({
                "key": "conversation:a",
                "messageId": "message-42"
            })
        );
    }

    #[test]
    fn current_window_wins_when_it_already_owns_the_entity() {
        let mut inner = RegistryInner::default();
        inner.register(
            "main",
            "renderer-main",
            1,
            vec![tab("conversation:a", true)],
        );
        inner.register(
            "tab-1",
            "renderer-tab",
            1,
            vec![tab("conversation:a", true)],
        );

        assert_eq!(
            inner.decide("conversation:a", "main"),
            RouteDecision::Current
        );
    }

    #[test]
    fn latest_focused_other_window_is_selected() {
        let mut inner = RegistryInner::default();
        inner.register(
            "main",
            "renderer-main",
            1,
            vec![tab("conversation:other", true)],
        );
        inner.register(
            "tab-1",
            "renderer-tab",
            1,
            vec![tab("conversation:a", true)],
        );
        inner.touch_window("tab-1");

        assert_eq!(
            inner.decide("conversation:a", "main"),
            RouteDecision::Other("tab-1".to_string())
        );
    }

    #[test]
    fn stale_renderer_revision_cannot_restore_closed_tabs() {
        let mut inner = RegistryInner::default();
        inner.register(
            "main",
            "renderer-main",
            2,
            vec![tab("conversation:new", true)],
        );
        inner.register(
            "main",
            "renderer-main",
            1,
            vec![tab("conversation:old", true)],
        );

        assert_eq!(
            inner.decide("conversation:new", "tab-1"),
            RouteDecision::Other("main".to_string())
        );
        assert_eq!(
            inner.decide("conversation:old", "tab-1"),
            RouteDecision::CreateCurrent
        );
    }

    #[test]
    fn reloaded_renderer_can_restart_its_revision_epoch() {
        let mut inner = RegistryInner::default();
        inner.register(
            "main",
            "renderer-before-reload",
            9,
            vec![tab("conversation:stale", true)],
        );
        inner.register(
            "main",
            "renderer-after-reload",
            1,
            vec![tab("conversation:fresh", true)],
        );

        assert_eq!(
            inner.decide("conversation:stale", "tab-1"),
            RouteDecision::CreateCurrent
        );
        assert_eq!(
            inner.decide("conversation:fresh", "tab-1"),
            RouteDecision::Other("main".to_string())
        );
    }

    #[test]
    fn destroyed_windows_release_all_claims() {
        let mut inner = RegistryInner::default();
        inner.register(
            "tab-1",
            "renderer-tab",
            1,
            vec![tab("conversation:a", true)],
        );
        inner.remove_window("tab-1");

        assert_eq!(
            inner.decide("conversation:a", "main"),
            RouteDecision::CreateCurrent
        );
    }
}
