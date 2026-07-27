import { useHotkey } from "@ryu/hotkeys/react";
import { useEffect, useEffectEvent, useRef } from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { readTabSwitchBehavior } from "@/src/hooks/useTabSwitchBehavior.ts";

/** A Ctrl/Cmd+Tab hold session: frozen tab order + the index currently shown. */
interface CycleSession {
	index: number;
	order: string[];
}

/**
 * Ctrl/Cmd+Tab and Ctrl/Cmd+Shift+Tab cycle through open window tabs.
 *
 * Sequential (default): left-to-right strip order, wrapping.
 * Recent: most-recently-active order (current tab first). Holding Mod and
 * pressing Tab repeatedly walks the frozen list; releasing Mod commits the
 * selection and updates MRU — same hold-to-cycle pattern as Chrome / VS Code.
 */
export function useTabCycleHotkeys() {
	const { tabs, activeTabId, activateTab, focusTab } = useTabsContext();

	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeTabIdRef = useRef(activeTabId);
	activeTabIdRef.current = activeTabId;

	// Most-recently-active order, current tab first. Updated on organic
	// activation; frozen for the duration of a Mod+Tab hold session.
	const mruRef = useRef<string[]>(activeTabId ? [activeTabId] : []);
	const sessionRef = useRef<CycleSession | null>(null);
	const cyclingRef = useRef(false);

	// Keep the MRU list in sync with open tabs and organic activations.
	useEffect(() => {
		const ids = new Set(tabs.map((t) => t.id));
		mruRef.current = mruRef.current.filter((id) => ids.has(id));
		for (const tab of tabs) {
			if (!mruRef.current.includes(tab.id)) {
				mruRef.current.push(tab.id);
			}
		}
	}, [tabs]);

	useEffect(() => {
		if (cyclingRef.current || !activeTabId) {
			return;
		}
		mruRef.current = [
			activeTabId,
			...mruRef.current.filter((id) => id !== activeTabId),
		];
	}, [activeTabId]);

	const endSession = useEffectEvent(() => {
		const session = sessionRef.current;
		if (!session) {
			return;
		}
		sessionRef.current = null;
		cyclingRef.current = false;
		const id = activeTabIdRef.current;
		if (!id) {
			return;
		}
		// Commit MRU before activateTab's organic path re-reads it.
		mruRef.current = [id, ...mruRef.current.filter((x) => x !== id)];
		activateTab(id);
	});

	const cycle = useEffectEvent((direction: 1 | -1) => {
		const current = tabsRef.current;
		if (current.length < 2) {
			return;
		}

		let session = sessionRef.current;
		if (!session) {
			const behavior = readTabSwitchBehavior();
			const order =
				behavior === "recent"
					? buildRecentOrder(
							current.map((t) => t.id),
							activeTabIdRef.current,
							mruRef.current
						)
					: current.map((t) => t.id);
			const index = Math.max(0, order.indexOf(activeTabIdRef.current));
			session = { order, index };
			sessionRef.current = session;
			cyclingRef.current = true;
		}

		const len = session.order.length;
		if (len < 2) {
			return;
		}
		session.index = (session.index + direction + len) % len;
		const nextId = session.order[session.index];
		if (nextId) {
			// Preview without writing history — commit on Mod release.
			focusTab(nextId);
		}
	});

	useHotkey("tab.next", (e) => {
		if (e.repeat) {
			return;
		}
		cycle(1);
	});
	useHotkey("tab.prev", (e) => {
		if (e.repeat) {
			return;
		}
		cycle(-1);
	});

	// Commit the held cycle when the modifier is released. Listen for both
	// Control and Meta so Mod+Tab works on Windows/Linux and macOS.
	useEffect(() => {
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Control" || e.key === "Meta") {
				endSession();
			}
		};
		// If the window blurs mid-hold (alt-tab away), drop the session so the
		// next Mod+Tab starts a fresh order instead of resuming a stale one.
		const onBlur = () => endSession();
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, []);
}

/** Build MRU order with the active tab first, then remaining by recency. */
function buildRecentOrder(
	openIds: string[],
	activeId: string,
	mru: string[]
): string[] {
	const open = new Set(openIds);
	const ordered: string[] = [];
	if (activeId && open.has(activeId)) {
		ordered.push(activeId);
	}
	for (const id of mru) {
		if (open.has(id) && id !== activeId) {
			ordered.push(id);
		}
	}
	for (const id of openIds) {
		if (!ordered.includes(id)) {
			ordered.push(id);
		}
	}
	return ordered;
}
