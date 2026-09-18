import type { RunSummary } from "@/src/hooks/useRuns.ts";
import { abortableDelay } from "../abortable-delay.ts";
import type { ApiTarget } from "./client.ts";
import { type RunStreamFrame, streamRuns } from "./runStream.ts";

interface RunFeed {
	controller: AbortController;
	frames: Set<(frame: RunStreamFrame) => void>;
	listeners: Set<() => void>;
	loaded: boolean;
	runs: RunSummary[];
	statuses: Map<string, string>;
}
const feeds = new Map<string, RunFeed>();
const EMPTY_RUNS: RunSummary[] = [];
const PATH_SEPARATOR_RE = /[\\/]/;
function key(target: ApiTarget): string {
	return JSON.stringify([
		target.url,
		target.token ?? null,
		target.userJwt ?? null,
	]);
}
export function getRunsSnapshot(target: ApiTarget): RunSummary[] {
	return feeds.get(key(target))?.runs ?? EMPTY_RUNS;
}
function receive(feed: RunFeed, frame: RunStreamFrame) {
	if (feed.controller.signal.aborted) {
		return;
	}
	if (frame.type === "snapshot") {
		feed.runs = frame.runs;
		feed.statuses.clear();
		for (const run of frame.runs) {
			if (run.run_status) {
				feed.statuses.set(run.id, run.run_status);
			}
		}
	} else {
		const run = frame.run;
		const index = feed.runs.findIndex((item) => item.id === run.id);
		const next = feed.runs.slice();
		if (index === -1) {
			next.push(run);
		} else {
			next[index] = run;
		}
		feed.runs = next;
		const status = run.run_status ?? "";
		if (
			feed.listeners.size > 0 &&
			feed.statuses.get(run.id) === "running" &&
			(status === "completed" || status === "failed")
		) {
			fireRunNotification(run, status, () => !feed.controller.signal.aborted);
		}
		if (status) {
			feed.statuses.set(run.id, status);
		}
	}
	feed.loaded = true;
	for (const listener of [...feed.frames]) {
		if (feed.frames.has(listener)) {
			listener(frame);
		}
	}
	for (const listener of [...feed.listeners]) {
		if (feed.listeners.has(listener)) {
			listener();
		}
	}
}
async function connect(feed: RunFeed, target: ApiTarget) {
	let backoff = 500;
	while (!feed.controller.signal.aborted) {
		try {
			await streamRuns(
				target,
				(frame) => receive(feed, frame),
				feed.controller.signal
			);
			backoff = 500;
		} catch {
			/* Retry while observed. */
		}
		await abortableDelay(backoff, feed.controller.signal);
		backoff = Math.min(backoff * 2, 10_000);
	}
}
function acquire(target: ApiTarget) {
	const scope = key(target);
	let feed = feeds.get(scope);
	const start = !feed;
	if (!feed) {
		feed = {
			controller: new AbortController(),
			frames: new Set(),
			loaded: false,
			listeners: new Set(),
			runs: EMPTY_RUNS,
			statuses: new Map(),
		};
		feeds.set(scope, feed);
	}
	return { scope, feed, start };
}
function release(scope: string, feed: RunFeed) {
	if (feed.listeners.size || feed.frames.size) {
		return;
	}
	if (feeds.get(scope) === feed) {
		feeds.delete(scope);
	}
	feed.runs = EMPTY_RUNS;
	feed.statuses.clear();
	feed.controller.abort();
}
export function subscribeRuns(
	target: ApiTarget,
	listener: () => void
): () => void {
	const { scope, feed, start } = acquire(target);
	const notify = () => listener();
	feed.listeners.add(notify);
	if (start) {
		void connect(feed, target);
	}
	return () => {
		feed.listeners.delete(notify);
		release(scope, feed);
	};
}
/** Replays current data as a snapshot, then preserves delta semantics for adapters. */
export function subscribeRunFrames(
	target: ApiTarget,
	listener: (frame: RunStreamFrame) => void
): () => void {
	const { scope, feed, start } = acquire(target);
	const notify = (frame: RunStreamFrame) => listener(frame);
	feed.frames.add(notify);
	try {
		if (feed.loaded) {
			notify({ type: "snapshot", runs: feed.runs });
		}
	} catch (error) {
		feed.frames.delete(notify);
		release(scope, feed);
		throw error;
	}
	if (start) {
		void connect(feed, target);
	}
	return () => {
		feed.frames.delete(notify);
		release(scope, feed);
	};
}

function fireRunNotification(
	run: RunSummary,
	status: string,
	isCurrent: () => boolean
) {
	if (!("Notification" in window)) {
		return;
	}

	const title = status === "completed" ? "Run completed" : "Run failed";
	const folder = run.folder_path?.split(PATH_SEPARATOR_RE).pop() ?? "";
	const branch = run.branch ?? "";
	const body = [
		run.title,
		folder && `folder: ${folder}`,
		branch && `branch: ${branch}`,
	]
		.filter(Boolean)
		.join(" · ");

	const fire = () => {
		if (!isCurrent()) {
			return;
		}
		const n = new Notification(title, { body, tag: run.id });
		n.onclick = () => {
			window.focus();
			window.dispatchEvent(
				new CustomEvent("ryu:run-notification-click", {
					detail: { runId: run.id },
				})
			);
		};
	};

	if (Notification.permission === "granted") {
		fire();
	} else if (Notification.permission === "default") {
		Notification.requestPermission().then((perm) => {
			if (perm === "granted") {
				fire();
			}
		});
	}
}
