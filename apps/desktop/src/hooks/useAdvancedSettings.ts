// apps/desktop/src/hooks/useAdvancedSettings.ts
//
// One shared, persisted toggle for "show advanced settings". OFF by default:
// settings surfaces hide the operator/developer-tier sections (model routing,
// quality tests, the raw activity log, …) until it is flipped, so the default
// nav is the short list a normal person needs.
//
// Deliberately NOT `useFriendlyMode`: that one controls *naming* (title-cased
// model names, plain-language quant labels) and is read by the Store catalog,
// the Download Center, and the Appearance tab. Reusing it would tie "I want to
// see raw model ids" to "hide half the settings", which are different wishes.
//
// Nothing is ever removed by this flag — an advanced section still shows up when
// it matches a settings search, and every deep link to one still opens it.

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ryu.settings.advanced";

const listeners = new Set<() => void>();

function read(): boolean {
	try {
		// Default OFF: only an explicit "true" opts in.
		return localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	// Cross-window updates (a second desktop window) stay in sync too.
	const onStorage = (e: StorageEvent) => {
		if (e.key === STORAGE_KEY) {
			cb();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

/** Default OFF — advanced sections stay hidden until explicitly revealed. */
export const DEFAULT_ADVANCED_SETTINGS = false;

/** Write the advanced-settings preference and notify every consumer. */
export function setAdvancedSettings(v: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, v ? "true" : "false");
	} catch {
		// Non-fatal: persistence is best-effort.
	}
	for (const cb of listeners) {
		cb();
	}
}

/** `[advanced, setAdvanced]`. Persisted, default `false`, shared app-wide. */
export function useAdvancedSettings(): [boolean, (v: boolean) => void] {
	const advanced = useSyncExternalStore(subscribe, read, () => false);

	const setAdvanced = useCallback((v: boolean) => {
		setAdvancedSettings(v);
	}, []);

	return [advanced, setAdvanced];
}
