// apps/desktop/src/hooks/useSidebarGroupedNav.ts
//
// One shared, persisted toggle for HOW the sidebar's Projects and Spaces sections
// present themselves.
//
// ON (the default) — each section is a single picker: "All projects" lists every chat
// across every project, "All spaces" lists every page, database and file across every
// space, and choosing one narrows the list to it. A user with twenty imported folders
// and a dozen spaces gets two rows of chrome instead of thirty-two collapsed headers.
//
// OFF — the original model: every project and every space is its own expandable row.
// Kept as a real setting rather than dropped, because the flat model is genuinely
// better at a handful of projects (everything is one click away, nothing is behind a
// picker) and it is the layout existing users already have muscle memory for.
//
// Orthogonal to `useChatDateGrouping`: that decides whether the rows a list shows are
// bucketed by date, and it applies in BOTH modes (including to "All projects" /
// "All spaces", where the mixed-source list is exactly where dates help most).
//
// Same tiny external-store shape as `useChatDateGrouping` so the Appearance setting
// and the sidebar stay in sync the instant either flips it, across windows.

import { useCallback, useSyncExternalStore } from "react";

export const SIDEBAR_GROUPED_NAV_KEY = "ryu:sidebar-grouped-nav";
/** Default ON: only an explicit `"false"` restores the list-everything model. */
export const DEFAULT_SIDEBAR_GROUPED_NAV = true;

const listeners = new Set<() => void>();

function read(): boolean {
	try {
		// Default-ON, so absence means on and only the explicit opt-out reads false.
		return localStorage.getItem(SIDEBAR_GROUPED_NAV_KEY) !== "false";
	} catch {
		return DEFAULT_SIDEBAR_GROUPED_NAV;
	}
}

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	// Cross-window updates (e.g. a second desktop window) stay in sync too.
	const onStorage = (e: StorageEvent) => {
		if (e.key === SIDEBAR_GROUPED_NAV_KEY) {
			cb();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

/** Write the grouped-nav preference and notify every consumer. */
export function setSidebarGroupedNav(v: boolean): void {
	try {
		localStorage.setItem(SIDEBAR_GROUPED_NAV_KEY, v ? "true" : "false");
	} catch {
		// Non-fatal: persistence is best-effort.
	}
	for (const cb of listeners) {
		cb();
	}
}

/**
 * `[groupedNav, setGroupedNav]`. Persisted, default `true`, shared across windows.
 */
export function useSidebarGroupedNav(): [boolean, (v: boolean) => void] {
	const groupedNav = useSyncExternalStore(
		subscribe,
		read,
		() => DEFAULT_SIDEBAR_GROUPED_NAV
	);

	const setGroupedNav = useCallback((v: boolean) => {
		setSidebarGroupedNav(v);
	}, []);

	return [groupedNav, setGroupedNav];
}
