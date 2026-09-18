// apps/desktop/src/live/adapters/agent-runs.ts
//
// Built-in live-activity adapter for AGENT RUNS — the flagship "ongoing chats
// expose a live activity" card. Subscribes to Core's `/api/runs/stream`
// (snapshot-first) and publishes one card per run: `running` while an agent is
// working, transitioning to `done`/`error` on the terminal frame. Terminal cards
// linger briefly (so the dock shows "just finished") then auto-remove.
//
// The run id IS the conversation id (see `lib/api/runs.ts`), so tapping the card
// opens the chat that owns the run.

import type { LiveActivity } from "@ryu/app-host/live-activity";
import { useEffect } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import type { RunSummary } from "@/src/hooks/useRuns.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import { subscribeRunFrames } from "@/src/lib/api/run-store.ts";
import type { RunStreamFrame } from "@/src/lib/api/runStream.ts";
import { useLiveActivityStore } from "@/src/store/useLiveActivityStore.ts";

const TERMINAL_LINGER_MS = 8000;

/** Split a run's folder path on either separator to show its basename. */
const PATH_SEPARATOR_RE = /[\\/]/;

function runId(id: string): string {
	return `run:${id}`;
}

/** Map a run to its live-activity card. The run id is the conversation id, so the
 *  card opens the owning chat. */
function runToActivity(run: RunSummary): LiveActivity {
	const folder = run.folder_path?.split(PATH_SEPARATOR_RE).pop() ?? "";
	const detail = [folder, run.branch && `@ ${run.branch}`]
		.filter(Boolean)
		.join(" · ");
	const status =
		run.run_status === "completed"
			? "done"
			: run.run_status === "awaiting_input"
				? "waiting"
				: run.run_status === "failed"
					? "error"
					: run.run_status === "interrupted"
						? "error"
						: "running";
	const stateDetail =
		run.run_status === "awaiting_input"
			? "Needs your input"
			: run.run_status === "interrupted"
				? "Interrupted — continue manually"
				: run.run_status === "failed"
					? "Failed"
					: "Working…";
	return {
		id: runId(run.id),
		appId: "shell",
		kind: "agent-run",
		title: run.title ?? "Agent run",
		detail: detail || stateDetail,
		status,
		icon: "loader-circle",
		startedAt: run.created_at * 1000,
		updatedAt: run.updated_at * 1000,
		action: {
			kind: "route",
			path: `/chat?conversationId=${encodeURIComponent(run.id)}`,
		},
	};
}

/** This producer owns only shell/agent-run cards and its own linger timers. */
export function useAgentRunLiveActivities(): void {
	const { url, token, userJwt } = useActiveNode();
	useEffect(() => {
		let stopped = false;
		const timers = new Map<string, ReturnType<typeof setTimeout>>();
		const clearTimers = () => {
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
			timers.clear();
		};
		const replace = (runs: RunSummary[]) =>
			useLiveActivityStore
				.getState()
				.applySourceSnapshot("shell", "agent-run", runs.map(runToActivity));
		replace([]);
		const stop = subscribeRunFrames(
			toTarget({ url, token, userJwt }),
			(frame: RunStreamFrame) => {
				if (stopped) {
					return;
				}
				if (frame.type === "snapshot") {
					clearTimers();
					replace(frame.runs);
					return;
				}
				const activity = runToActivity(frame.run);
				const previous = timers.get(activity.id);
				if (previous !== undefined) {
					clearTimeout(previous);
					timers.delete(activity.id);
				}
				useLiveActivityStore.getState().upsert(activity);
				if (activity.status === "done" || activity.status === "error") {
					const timer = setTimeout(() => {
						if (stopped || timers.get(activity.id) !== timer) {
							return;
						}
						timers.delete(activity.id);
						useLiveActivityStore.getState().remove(activity.id);
					}, TERMINAL_LINGER_MS);
					timers.set(activity.id, timer);
				}
			}
		);
		return () => {
			stopped = true;
			stop();
			clearTimers();
			replace([]);
		};
	}, [url, token, userJwt]);
}
