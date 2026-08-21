import type { DockTabKind } from "@/src/components/panels/dock-panels.ts";

/** The serializable identity of one workspace dock tab. */
export interface WorkspaceSessionTab {
	kind: DockTabKind;
	label: string;
	/** Project tabs marked shared remain pinned if the dock store rebuilds them. */
	pinned?: boolean;
	/** Project-hosted tabs are restored through the project dock store. */
	project?: boolean;
	/** Runtime uid used to restore a tab's exact selection after a relaunch. */
	uid?: string;
}

export interface WorkspaceSessionDock {
	activeIndex: number;
	tabs: WorkspaceSessionTab[];
}

/** Workspace state attached to a chat's persisted desktop tab. */
export interface WorkspaceSessionState {
	bottom: WorkspaceSessionDock;
	bottomOpen: boolean;
	right: WorkspaceSessionDock;
	rightOpen: boolean;
}

export function emptyWorkspaceSessionState(): WorkspaceSessionState {
	return {
		bottom: { activeIndex: 0, tabs: [] },
		bottomOpen: false,
		right: { activeIndex: 0, tabs: [] },
		rightOpen: false,
	};
}

function parseTab(value: unknown): WorkspaceSessionTab | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const row = value as Record<string, unknown>;
	if (
		typeof row.kind !== "string" ||
		row.kind.length === 0 ||
		row.kind.length > 512 ||
		typeof row.label !== "string"
	) {
		return null;
	}
	return {
		kind: row.kind as DockTabKind,
		label: row.label,
		...(row.project === true ? { project: true } : {}),
		...(row.pinned === true ? { pinned: true } : {}),
		...(typeof row.uid === "string" && row.uid.length > 0
			? { uid: row.uid }
			: {}),
	};
}

function parseDock(value: unknown): WorkspaceSessionDock {
	if (!value || typeof value !== "object") {
		return { activeIndex: 0, tabs: [] };
	}
	const row = value as Record<string, unknown>;
	const tabs = Array.isArray(row.tabs)
		? row.tabs.flatMap((tab) => {
				const parsed = parseTab(tab);
				return parsed ? [parsed] : [];
			})
		: [];
	const rawIndex = typeof row.activeIndex === "number" ? row.activeIndex : 0;
	return {
		activeIndex:
			tabs.length === 0
				? 0
				: Math.min(Math.max(0, Math.trunc(rawIndex)), tabs.length - 1),
		tabs,
	};
}

/** Validate and normalize a value read from a persisted chat tab. */
export function parseWorkspaceSessionState(
	value: unknown
): WorkspaceSessionState | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const row = value as Record<string, unknown>;
	return {
		bottom: parseDock(row.bottom),
		bottomOpen: row.bottomOpen === true,
		right: parseDock(row.right),
		rightOpen: row.rightOpen === true,
	};
}

/** Compare snapshots without making React updates for an unchanged dock. */
function sameWorkspaceSessionDock(
	left: WorkspaceSessionDock | undefined,
	right: WorkspaceSessionDock | undefined
): boolean {
	if (!(left && right)) {
		return left === right;
	}
	if (
		left.activeIndex !== right.activeIndex ||
		left.tabs.length !== right.tabs.length
	) {
		return false;
	}
	return left.tabs.every((tab, index) => {
		const candidate = right.tabs[index];
		return (
			candidate !== undefined &&
			tab.kind === candidate.kind &&
			tab.label === candidate.label &&
			Boolean(tab.pinned) === Boolean(candidate.pinned) &&
			Boolean(tab.project) === Boolean(candidate.project) &&
			tab.uid === candidate.uid
		);
	});
}

export function sameWorkspaceSessionState(
	left: WorkspaceSessionState | undefined,
	right: WorkspaceSessionState | undefined
): boolean {
	if (!(left && right)) {
		return left === right;
	}
	return (
		sameWorkspaceSessionDock(left.bottom, right.bottom) &&
		left.bottomOpen === right.bottomOpen &&
		sameWorkspaceSessionDock(left.right, right.right) &&
		left.rightOpen === right.rightOpen
	);
}
