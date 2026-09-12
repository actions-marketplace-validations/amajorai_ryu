import type { Tab } from "@/src/contexts/TabsContext.tsx";
import type { Artifact } from "@/src/lib/artifacts.ts";

/** Memory-only carriage between trusted Desktop renderers. Never stored in a
 * URL, preferences, or the previous-session snapshot. Native only transports
 * this JSON; the tab owner defines its shape. */
export interface TabTransfer {
	artifact?: Artifact;
	node?: string;
	tab: Tab;
	version: 1;
}

type SnapshotReader = () => Partial<Tab>;
const readers = new Map<string, SnapshotReader>();

export class TabTransferBlockedError extends Error {}

/** Pages supply live, unsaved view state without making the shell its owner. */
export function registerTabSnapshot(id: string, read: SnapshotReader) {
	readers.set(id, read);
	return () => {
		if (readers.get(id) === read) {
			readers.delete(id);
		}
	};
}

export function snapshotTab(tab: Tab): Tab {
	return {
		...tab,
		...readers.get(tab.id)?.(),
		// Membership and renderer lifecycle belong to the source window. Moving
		// a pane must not recreate the other panes or re-submit a consumed seed.
		groupId: undefined,
		splitId: undefined,
		busy: undefined,
		busySpeed: undefined,
		unloaded: false,
		navToken: undefined,
		initialSubmit: undefined,
		initialProactiveOpening: undefined,
	};
}

declare global {
	interface Window {
		__RYU_TAB_TRANSFER__?: TabTransfer;
	}
}

export function readTabTransfer(): TabTransfer | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	const transfer = window.__RYU_TAB_TRANSFER__;
	return transfer?.version === 1 && transfer.tab?.id && transfer.tab.path
		? transfer
		: undefined;
}

export function isDetachedTabWindow(): boolean {
	return (
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("detached") === "1"
	);
}

/** Do not interpret a successful drop (including a copied chat reference), an
 * Escape, or a drag with a mouse button still held as a tear-out. Native also
 * checks the actual cursor against the source window, independent of WebKit's
 * unreliable dragend client coordinates. */
export function canTearOutTab(
	dropEffect: string,
	buttons: number,
	cancelled: boolean
) {
	return dropEffect === "none" && buttons === 0 && !cancelled;
}
