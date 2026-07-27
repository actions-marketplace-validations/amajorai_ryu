// apps/desktop/src/store/useProjectDockStore.ts
//
// Project-scoped workspace dock tabs. Shareable kinds (terminal, files,
// browser, …) live here keyed by folder so a pinned tab is the same live
// instance across every chat in that project. Unpinned entries stay owned by
// the window-tab that created them; pinning opts them into the shared strip.

import { create } from "zustand";
import type {
	DockSide,
	DockTabKind,
} from "@/src/components/panels/dock-panels.ts";

const STORAGE_KEY = "ryu_pinned_dock_tabs";

export interface ProjectDockTab {
	kind: DockTabKind;
	label: string;
	/** Window-tab id that owns this entry while unpinned. Ignored when pinned. */
	ownerTabId: string;
	pinned: boolean;
	side: DockSide;
	uid: string;
}

/** Persisted shape — only pinned tabs survive a reload (fresh content, same kind). */
interface PersistedPinnedTab {
	kind: DockTabKind;
	label: string;
	side: DockSide;
}

type PersistedByFolder = Record<string, PersistedPinnedTab[]>;

function loadPersisted(): PersistedByFolder {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return {};
		}
		const out: PersistedByFolder = {};
		for (const [folder, tabs] of Object.entries(
			parsed as Record<string, unknown>
		)) {
			if (!Array.isArray(tabs)) {
				continue;
			}
			out[folder] = tabs.flatMap((t) => {
				if (!t || typeof t !== "object") {
					return [];
				}
				const row = t as Record<string, unknown>;
				if (
					typeof row.kind !== "string" ||
					typeof row.label !== "string" ||
					(row.side !== "bottom" && row.side !== "right")
				) {
					return [];
				}
				return [
					{
						kind: row.kind as DockTabKind,
						label: row.label,
						side: row.side,
					},
				];
			});
		}
		return out;
	} catch {
		return {};
	}
}

function persistPinned(byFolder: Record<string, ProjectDockTab[]>) {
	const out: PersistedByFolder = {};
	for (const [folder, tabs] of Object.entries(byFolder)) {
		const pinned = tabs
			.filter((t) => t.pinned)
			.map((t) => ({ kind: t.kind, label: t.label, side: t.side }));
		if (pinned.length > 0) {
			out[folder] = pinned;
		}
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
	} catch {
		// Best-effort; ignore quota / private-mode failures.
	}
}

let dockTabCounter = 0;
export function mintProjectDockUid(): string {
	dockTabCounter += 1;
	return `project-dock-${dockTabCounter}-${Date.now().toString(36)}`;
}

function hydrateFromStorage(): Record<string, ProjectDockTab[]> {
	const persisted = loadPersisted();
	const byFolder: Record<string, ProjectDockTab[]> = {};
	for (const [folder, tabs] of Object.entries(persisted)) {
		byFolder[folder] = tabs.map((t) => ({
			uid: mintProjectDockUid(),
			kind: t.kind,
			label: t.label,
			side: t.side,
			pinned: true,
			// Restored pins have no owning chat — they are project-shared.
			ownerTabId: "",
		}));
	}
	return byFolder;
}

interface ProjectDockState {
	addTab: (
		folder: string,
		tab: Omit<ProjectDockTab, "uid"> & { uid?: string }
	) => ProjectDockTab;
	byFolder: Record<string, ProjectDockTab[]>;
	/** Drop unpinned tabs owned by a closed/unloaded window tab. */
	clearOwner: (folder: string, ownerTabId: string) => void;
	removeTab: (folder: string, uid: string) => void;
	setLabel: (folder: string, uid: string, label: string) => void;
	setSide: (folder: string, uid: string, side: DockSide) => void;
	togglePin: (folder: string, uid: string) => void;
	updateTab: (
		folder: string,
		uid: string,
		patch: Partial<Pick<ProjectDockTab, "label" | "side" | "pinned">>
	) => void;
}

export const useProjectDockStore = create<ProjectDockState>((set, get) => ({
	byFolder: hydrateFromStorage(),

	addTab: (folder, tab) => {
		const entry: ProjectDockTab = {
			uid: tab.uid ?? mintProjectDockUid(),
			kind: tab.kind,
			label: tab.label,
			side: tab.side,
			pinned: tab.pinned,
			ownerTabId: tab.ownerTabId,
		};
		set((state) => {
			const prev = state.byFolder[folder] ?? [];
			const byFolder = {
				...state.byFolder,
				[folder]: [...prev, entry],
			};
			persistPinned(byFolder);
			return { byFolder };
		});
		return entry;
	},

	removeTab: (folder, uid) => {
		set((state) => {
			const prev = state.byFolder[folder] ?? [];
			const next = prev.filter((t) => t.uid !== uid);
			const byFolder = { ...state.byFolder };
			if (next.length === 0) {
				delete byFolder[folder];
			} else {
				byFolder[folder] = next;
			}
			persistPinned(byFolder);
			return { byFolder };
		});
	},

	togglePin: (folder, uid) => {
		set((state) => {
			const prev = state.byFolder[folder] ?? [];
			const byFolder = {
				...state.byFolder,
				[folder]: prev.map((t) =>
					t.uid === uid ? { ...t, pinned: !t.pinned } : t
				),
			};
			persistPinned(byFolder);
			return { byFolder };
		});
	},

	setSide: (folder, uid, side) => {
		get().updateTab(folder, uid, { side });
	},

	setLabel: (folder, uid, label) => {
		get().updateTab(folder, uid, { label });
	},

	updateTab: (folder, uid, patch) => {
		set((state) => {
			const prev = state.byFolder[folder] ?? [];
			const byFolder = {
				...state.byFolder,
				[folder]: prev.map((t) => (t.uid === uid ? { ...t, ...patch } : t)),
			};
			persistPinned(byFolder);
			return { byFolder };
		});
	},

	clearOwner: (folder, ownerTabId) => {
		set((state) => {
			const prev = state.byFolder[folder] ?? [];
			const next = prev.filter((t) => t.pinned || t.ownerTabId !== ownerTabId);
			if (next.length === prev.length) {
				return state;
			}
			const byFolder = { ...state.byFolder };
			if (next.length === 0) {
				delete byFolder[folder];
			} else {
				byFolder[folder] = next;
			}
			persistPinned(byFolder);
			return { byFolder };
		});
	},
}));

/** Tabs visible in a given chat's dock strip for one side. */
export function visibleProjectDockTabs(
	tabs: ProjectDockTab[],
	side: DockSide,
	ownerTabId: string | undefined
): ProjectDockTab[] {
	return tabs.filter(
		(t) =>
			t.side === side &&
			(t.pinned || (ownerTabId != null && t.ownerTabId === ownerTabId))
	);
}
