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

import { useEffect, useRef } from "react";
import type { LiveActivity } from "@ryu/app-host/live-activity";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import type { RunSummary } from "@/src/hooks/useRuns.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import type { RunStreamFrame } from "@/src/lib/api/runStream.ts";
import { streamRuns } from "@/src/lib/api/runStream.ts";
import { useLiveActivityStore } from "@/src/store/useLiveActivityStore.ts";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
const TERMINAL_LINGER_MS = 8_000;

/** Split a run's folder path on either separator to show its basename. */
const PATH_SEPARATOR_RE = /[\\/]/;

function runId(id: string): string {
	return `run:${id}`;
}

/** Map a run to its live-activity card. The run id is the conversation id, so the
 *  card opens the owning chat. */
function runToActivity(run: RunSummary): LiveActivity {
	const folder = run.folder_path?.split(PATH_SEPARATOR_RE).pop() ?? "";
	const detail = [folder, run.branch && `@ ${run.branch}`].filter(Boolean).join(" · ");
	const status =
		run.run_status === "completed"
			? "done"
			: run.run_status === "failed"
				? "error"
				: "running";
	return {
		id: runId(run.id),
		appId: "shell",
		kind: "agent-run",
		title: run.title ?? "Agent run",
		detail: detail || "Working…",
		status,
		icon: "loader-circle",
		startedAt: run.created_at * 1000,
		updatedAt: run.updated_at * 1000,
		action: { kind: "route", path: `/chat?conversationId=${encodeURIComponent(run.id)}` },
	};
}

/** Apply a run stream frame: snapshot replaces, a delta merges by id. */
function applyFrame(frame: RunStreamFrame) {
	const store = useLiveActivityStore.getState();
	if (frame.type === "snapshot") {
		store.applySnapshot(frame.runs.map(runToActivity));
		return;
	}
	const activity = runToActivity(frame.run);
	store.upsert(activity);
	// Terminal cards auto-remove after a short linger so the dock shows
	// "just finished" without accumulating settled runs.
	if (activity.status === "done" || activity.status === "error") {
		window.setTimeout(() => {
			useLiveActivityStore.getState().remove(activity.id);
		}, TERMINAL_LINGER_MS);
	}
}

/** Pause that resolves early when the stream is torn down. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

/** Mount ONE app-wide subscription to the runs stream feeding the live-activity
 *  store. Follows the active node and auto-reconnects, mirroring `useRuns`. */
export function useAgentRunLiveActivities(): void {
	const activeNode = useActiveNode();
	const url = activeNode.url;
	const token = activeNode.token ?? null;
	const resetRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		const target = toTarget(activeNode);

		// Drop the registry from any previous node; the snapshot event refills it.
		useLiveActivityStore.getState().reset();
		resetRef.current = () => useLiveActivityStore.getState().reset();

		const connect = async () => {
			let backoff = INITIAL_BACKOFF_MS;
			while (!signal.aborted) {
				try {
					await streamRuns(target, applyFrame, signal);
					backoff = INITIAL_BACKOFF_MS;
				} catch {
					// Connect/read failed (Core offline, transient drop) — reconnect.
				}
				if (signal.aborted) {
					break;
				}
				await delay(backoff, signal);
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			}
		};
		connect().catch(() => undefined);

		return () => {
			controller.abort();
			resetRef.current?.();
			resetRef.current = null;
		};
	}, [activeNode, url, token]);
}
