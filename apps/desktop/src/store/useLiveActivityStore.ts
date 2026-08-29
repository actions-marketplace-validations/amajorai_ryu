// apps/desktop/src/store/useLiveActivityStore.ts
//
// Client-side registry for the desktop's "Live Activities" — the Dynamic-Island
// half of the shell. Every live surface (the empty-shell launchpad dock, the
// sidebar Live section) reads from here, and every producer (the built-in
// adapters for agent runs / downloads / approvals / meetings, plus the
// contributed `contributes.live_activities` adapter) writes into here, so there
// is one client-side source of truth — the same pattern `useDownloadsStore`
// established for downloads.
//
// A live activity is keyed by a STABLE id (`run:<id>`, `download:<id>`,
// `plugin:<pluginId>:<activityId>:<rowId>`), so a producer upserts in place and
// a running item never flickers.

import type {
	LiveActivity,
	LiveActivityStatus,
} from "@ryu/app-host/live-activity";
import { isLiveStatus } from "@ryu/app-host/live-activity";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface LiveActivityState {
	/** All tracked activities, keyed by id. */
	activities: Record<string, LiveActivity>;
	/** Replace the whole set (a streamed snapshot, e.g. the runs snapshot). */
	applySnapshot: (activities: LiveActivity[]) => void;
	/** Drop one activity (removed/decided server-side). */
	remove: (id: string) => void;
	/** Clear the local registry (e.g. on node switch before re-subscribing). */
	reset: () => void;
	/** Upsert one activity by id (a live delta). */
	upsert: (activity: LiveActivity) => void;
}

export const useLiveActivityStore = create<LiveActivityState>((set) => ({
	activities: {},
	applySnapshot: (activities) =>
		set(() => ({
			activities: Object.fromEntries(activities.map((a) => [a.id, a])),
		})),
	upsert: (activity) =>
		set((s) => ({ activities: { ...s.activities, [activity.id]: activity } })),
	remove: (id) =>
		set((s) => {
			const next = { ...s.activities };
			delete next[id];
			return { activities: next };
		}),
	reset: () => set(() => ({ activities: {} })),
}));

/** Activities as a list, most-recently-updated first. */
export function selectOrderedActivities(s: LiveActivityState): LiveActivity[] {
	return Object.values(s.activities).sort(
		(a, b) => b.updatedAt - a.updatedAt || b.startedAt - a.startedAt
	);
}

/** Activities whose status is still in-flight (running/waiting/review), newest
 *  first — the set the empty-shell dock and sidebar surface render. Terminal
 *  (`done`/`error`) cards are surfaced briefly by their producer, then removed,
 *  so they do not accumulate here. */
export function selectActiveActivities(s: LiveActivityState): LiveActivity[] {
	return Object.values(s.activities)
		.filter((a) => isLiveStatus(a.status))
		.sort((a, b) => b.updatedAt - a.updatedAt || b.startedAt - a.startedAt);
}

/** How many live activities exist right now (any status). */
export function selectLiveActivityCount(s: LiveActivityState): number {
	return Object.keys(s.activities).length;
}

/** True when at least one built-in agent run is actively working. This is a
 * boolean on purpose: consumers such as ambient audio must not acquire one
 * playback owner per run. */
export function hasWorkingAgent(activities: readonly LiveActivity[]): boolean {
	return activities.some(
		(activity) =>
			activity.appId === "shell" &&
			activity.kind === "agent-run" &&
			activity.status === "running"
	);
}

/** Zustand selector for the aggregate working-run state. */
export function selectWorkingAgent(s: LiveActivityState): boolean {
	return hasWorkingAgent(Object.values(s.activities));
}

/** Subscribe to whether any agent run is currently working. */
export function useWorkingAgent(): boolean {
	return useLiveActivityStore(selectWorkingAgent);
}

/** The ordered live-activity list for a consumer that wants one subscription. */
export function useLiveActivities(): LiveActivity[] {
	return useLiveActivityStore(useShallow(selectActiveActivities));
}

/** The ordered list across every status (terminal included) — what a debugger or
 *  a "recently finished" surface wants. */
export function useAllLiveActivities(): LiveActivity[] {
	return useLiveActivityStore(useShallow(selectOrderedActivities));
}

export type { LiveActivity, LiveActivityStatus };
