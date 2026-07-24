// apps/desktop/src/hooks/useDeveloperMode.ts
//
// Centralized reactive hook for the "Developer mode" toggle. Backed by
// localStorage (`ryu_developer_mode`), synced across all consumers via
// usePersistedToggle's external-store pattern. Also exports a synchronous
// non-hook reader for code that runs outside React (e.g. module-level init).

import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

const KEY = "ryu_developer_mode";

/** Synchronous check — safe outside React (module init, event handlers). */
export function isDeveloperMode(): boolean {
	try {
		return localStorage.getItem(KEY) === "true";
	} catch {
		return false;
	}
}

/**
 * Reactive `[enabled, setEnabled]` pair for the developer mode toggle.
 * All consumers stay in sync the instant any of them flips it.
 */
export function useDeveloperMode(): [boolean, (v: boolean) => void] {
	return usePersistedToggle(KEY, false);
}
