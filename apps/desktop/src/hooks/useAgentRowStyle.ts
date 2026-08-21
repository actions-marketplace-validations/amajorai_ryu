// apps/desktop/src/hooks/useAgentRowStyle.ts
//
// How the sidebar's Agents section draws each row.
//
//   - "compact"   — today's single line: glyph, name, usage meter, edit button.
//   - "messaging" — a WhatsApp/Telegram-shaped row: a two-line-tall avatar on the
//                   left, the agent name and the time of its last message on the
//                   first line, and a one-line preview of that message below.
//
// Bot mode (`useSidebarMode() === "agent"`) forces "messaging" without writing
// it, so the stored preference survives a trip through that mode. Read
// `useAgentRowStylePref` when you need what the user chose rather than what is
// drawn.
//
// This is *presentation only*. Nothing about how conversations are stored,
// grouped or routed changes with it; switching back to "compact" restores the
// old row exactly. The preview text comes from Core
// (`GET /api/conversations?preview=1`), which the chat-history context only asks
// for while this pref is "messaging" — see ChatHistoryContext.
//
// Same tiny external-store shape as useUsageBarPrefs, so the sidebar and the
// Appearance tab stay in sync (including across windows, via the `storage`
// event) without a provider.

import { useSyncExternalStore } from "react";
import { useSidebarMode } from "@/src/hooks/useSidebarMode.ts";

export type AgentRowStyle = "compact" | "messaging";

const STORAGE_KEY = "ryu:agent-row-style";

/** Today's single-line row stays the default — the messaging layout is opt-in. */
export const DEFAULT_AGENT_ROW_STYLE: AgentRowStyle = "compact";

const listeners = new Set<() => void>();

function readFromStorage(): AgentRowStyle {
	try {
		return localStorage.getItem(STORAGE_KEY) === "messaging"
			? "messaging"
			: DEFAULT_AGENT_ROW_STYLE;
	} catch {
		return DEFAULT_AGENT_ROW_STYLE;
	}
}

let cache: AgentRowStyle = readFromStorage();

function getSnapshot(): AgentRowStyle {
	return cache;
}

function getServerSnapshot(): AgentRowStyle {
	return DEFAULT_AGENT_ROW_STYLE;
}

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	const onStorage = (e: StorageEvent) => {
		if (e.key === STORAGE_KEY) {
			cache = readFromStorage();
			cb();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

/** Persist the row style and notify every mounted surface. */
export function setAgentRowStyle(style: AgentRowStyle): void {
	cache = style;
	try {
		localStorage.setItem(STORAGE_KEY, style);
	} catch {
		// Best-effort persistence; in-memory state still updates.
	}
	for (const cb of listeners) {
		cb();
	}
}

/**
 * The STORED preference, ignoring Bot mode's override.
 *
 * Only the Appearance tab wants this: its switch must reflect what the user
 * actually chose, or turning Bot mode on would silently flip a switch the user
 * never touched — and leaving Bot mode would then leave the rows messaging-style
 * with no record of who asked for that. Every rendering surface wants
 * {@link useAgentRowStyle} instead.
 */
export function useAgentRowStylePref(): AgentRowStyle {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The EFFECTIVE sidebar agent-row style.
 *
 * Bot mode forces "messaging": the whole point of that mode is the roster of
 * named agents with avatar, last message and stamp, so a compact single-line row
 * there would be the mode without the thing the mode is. The override is derived,
 * never written — flipping back to Sections/Tabbed restores the stored choice.
 */
export function useAgentRowStyle(): AgentRowStyle {
	const stored = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot
	);
	const [sidebarMode] = useSidebarMode();
	return sidebarMode === "agent" ? "messaging" : stored;
}

/** True while the sidebar is drawing messaging-style agent rows. Read by the
 *  chat-history context to decide whether to ask Core for message previews. */
export function useMessagingRows(): boolean {
	return useAgentRowStyle() === "messaging";
}
