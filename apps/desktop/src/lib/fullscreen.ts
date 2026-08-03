// Electron-style fullscreen for the desktop window.
//
// Mimics Electron's View → Toggle Full Screen: a real OS fullscreen transition
// (Tauri `set_fullscreen`), not a CSS/DOM overlay. It routes through the
// `toggle_fullscreen` / `is_fullscreen` Rust commands rather than
// @tauri-apps/api's window API because `core:window:allow-set-fullscreen` is not
// granted in `src-tauri/capabilities/default.json`, and the capabilities there
// scope to fixed window labels — the `tab-{n}` windows `open_tab_window` spawns
// match none of them. App commands are not capability-gated, so one seam covers
// every window.
//
// Outside Tauri (browser-mode dev/QA, the webapp build) it degrades to the DOM
// Fullscreen API so the same menu item, hotkey and palette entry still do the
// obvious thing.
//
// State is a module singleton because fullscreen is per-window, not per-tree:
// the titlebar, the global context menu and the command palette all read the
// same value. It is deliberately NOT persisted — this is transient window state,
// unlike the UI scale it sits next to in the menu (see
// `lib/appearance-settings.ts`, which is for saved preferences with a reset).

import { useSyncExternalStore } from "react";

type Listener = (value: boolean) => void;

const listeners = new Set<Listener>();
let cached = false;
let watching = false;

function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function publish(value: boolean): void {
	if (value === cached) {
		return;
	}
	cached = value;
	for (const listener of listeners) {
		listener(value);
	}
}

/** Last known fullscreen state, without a round-trip. */
export function getFullscreen(): boolean {
	return cached;
}

/** Re-read the real window state and notify subscribers if it changed. */
export async function syncFullscreen(): Promise<boolean> {
	if (!isTauri()) {
		const value = Boolean(document.fullscreenElement);
		publish(value);
		return value;
	}
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		const value = await invoke<boolean>("is_fullscreen");
		publish(value);
		return value;
	} catch {
		// Older shell without the command, or a window that refused the read —
		// keep the last known value rather than lying about it.
		return cached;
	}
}

// Fullscreen can also be entered from outside the app (macOS green button,
// ⌃⌘F, the window manager), so the cached value has to follow the window, not
// just our own toggle. Started on first subscription and never torn down: the
// listener lives as long as the window does.
function startWatching(): void {
	if (watching) {
		return;
	}
	watching = true;
	// Seed the cache once, when the watcher starts — not per subscriber, or every
	// mount costs an IPC round-trip.
	void syncFullscreen();
	if (!isTauri()) {
		document.addEventListener("fullscreenchange", () => {
			publish(Boolean(document.fullscreenElement));
		});
		return;
	}
	import("@tauri-apps/api/webviewWindow")
		.then(({ getCurrentWebviewWindow }) =>
			// onResized fires on every fullscreen transition (PageWrapper relies on
			// the same signal for its edge-to-edge corners).
			getCurrentWebviewWindow().onResized(() => {
				void syncFullscreen();
			})
		)
		.catch(() => {
			// non-Tauri context — the DOM path above already covers it
		});
}

/** Subscribe to fullscreen changes. Returns an unsubscribe function. */
export function subscribeFullscreen(listener: Listener): () => void {
	listeners.add(listener);
	startWatching();
	return () => {
		listeners.delete(listener);
	};
}

// Module scope so the identity is stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes, and an inline arrow would do that on every
// render of every consumer.
const subscribe = (onStoreChange: () => void) =>
	subscribeFullscreen(onStoreChange);

/**
 * Flip fullscreen on the current window. Resolves to the state the window ended
 * up in. Throws if the shell refuses the transition, so callers can surface it.
 */
export async function toggleFullscreen(): Promise<boolean> {
	if (!isTauri()) {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
			publish(false);
			return false;
		}
		await document.documentElement.requestFullscreen();
		publish(true);
		return true;
	}
	const { invoke } = await import("@tauri-apps/api/core");
	const next = await invoke<boolean>("toggle_fullscreen");
	publish(next);
	return next;
}

/** React binding for the fullscreen state. */
export function useFullscreen(): boolean {
	return useSyncExternalStore(subscribe, getFullscreen, () => false);
}
