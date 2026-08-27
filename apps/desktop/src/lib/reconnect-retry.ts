import type { RunSummary } from "@/src/hooks/useRuns.ts";
import { type ApiTarget, apiUrl, makeHeaders } from "./api/client.ts";

export const RECONNECT_RETRY_PLUGIN_ID = "@ryu/reconnect-retry";
export const RECONNECT_RETRY_FEATURE_KIND = "reconnect-retry";
export const CHAT_RETRY_STARTED_EVENT = "ryu:chat-retry-started";

export const RECONNECT_RETRY_TTL_MS = 30 * 60 * 1000;
export const RECONNECT_RETRY_MAX_ATTEMPTS = 1;

export interface RetryCandidate {
	attempts: number;
	capturedAt: number;
	conversationId: string;
}

export interface RetrySelection {
	retained: RetryCandidate[];
	retry: RetryCandidate[];
}

/** Keep only safe, recent candidate records from local storage. */
export function normalizeRetryCandidates(
	candidates: readonly RetryCandidate[],
	now = Date.now()
): RetryCandidate[] {
	const byConversation = new Map<string, RetryCandidate>();
	for (const candidate of candidates) {
		if (
			typeof candidate.conversationId !== "string" ||
			candidate.conversationId.trim().length === 0 ||
			!Number.isFinite(candidate.capturedAt) ||
			candidate.capturedAt > now ||
			now - candidate.capturedAt > RECONNECT_RETRY_TTL_MS ||
			!Number.isInteger(candidate.attempts) ||
			candidate.attempts < 0
		) {
			continue;
		}
		const previous = byConversation.get(candidate.conversationId);
		if (!previous || candidate.capturedAt > previous.capturedAt) {
			byConversation.set(candidate.conversationId, {
				conversationId: candidate.conversationId,
				capturedAt: candidate.capturedAt,
				attempts: candidate.attempts,
			});
		}
	}
	return [...byConversation.values()];
}

/** Add currently running chats to the outage queue without duplicating ids. */
export function mergeOutageCandidates(
	existing: readonly RetryCandidate[],
	runs: readonly Pick<RunSummary, "id" | "run_status">[],
	now = Date.now()
): RetryCandidate[] {
	const byConversation = new Map(
		normalizeRetryCandidates(existing, now).map((candidate) => [
			candidate.conversationId,
			candidate,
		])
	);
	for (const run of runs) {
		if (run.run_status !== "running" || run.id.trim().length === 0) {
			continue;
		}
		if (!byConversation.has(run.id)) {
			byConversation.set(run.id, {
				conversationId: run.id,
				capturedAt: now,
				attempts: 0,
			});
		}
	}
	return [...byConversation.values()];
}

/**
 * Match outage candidates against Core's fresh run snapshot. A still-running
 * chat is retained for normal stream resume; only a terminal run is retried.
 */
export function selectPendingRetries(
	candidates: readonly RetryCandidate[],
	runs: readonly Pick<RunSummary, "id" | "run_status">[],
	now = Date.now()
): RetrySelection {
	const normalized = normalizeRetryCandidates(candidates, now);
	const byConversation = new Map(runs.map((run) => [run.id, run]));
	const retry: RetryCandidate[] = [];
	const retained: RetryCandidate[] = [];

	for (const candidate of normalized) {
		const run = byConversation.get(candidate.conversationId);
		if (!run) {
			continue;
		}
		if (run.run_status === "running") {
			retained.push(candidate);
			continue;
		}
		if (
			(run.run_status === "failed" || run.run_status === "interrupted") &&
			candidate.attempts < RECONNECT_RETRY_MAX_ATTEMPTS
		) {
			retry.push({ ...candidate, attempts: candidate.attempts + 1 });
		}
	}

	return { retry, retained };
}

/** The node-local storage namespace used by the enabled plugin. */
export function reconnectRetryStorageKey(nodeUrl: string): string {
	return `ryu:reconnect-retry:${nodeUrl}`;
}

export function loadRetryCandidates(storageKey: string): RetryCandidate[] {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) {
			return [];
		}
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? normalizeRetryCandidates(parsed as RetryCandidate[])
			: [];
	} catch {
		return [];
	}
}

export function saveRetryCandidates(
	storageKey: string,
	candidates: readonly RetryCandidate[]
): void {
	try {
		if (candidates.length === 0) {
			localStorage.removeItem(storageKey);
			return;
		}
		localStorage.setItem(storageKey, JSON.stringify(candidates));
	} catch {
		// A disabled/private storage area should not stop chat recovery.
	}
}

export async function fetchRuns(target: ApiTarget): Promise<RunSummary[]> {
	const response = await fetch(apiUrl(target, "/api/runs"), {
		headers: makeHeaders(target.token),
	});
	if (!response.ok) {
		throw new Error(`run snapshot failed: ${response.status}`);
	}
	const payload: unknown = await response.json();
	if (typeof payload !== "object" || payload === null) {
		return [];
	}
	const runs = (payload as { runs?: unknown }).runs;
	return Array.isArray(runs) ? (runs as RunSummary[]) : [];
}

export async function retryConversation(
	target: ApiTarget,
	conversationId: string
): Promise<void> {
	const response = await fetch(
		apiUrl(target, `/api/chat/retry/${encodeURIComponent(conversationId)}`),
		{
			body: JSON.stringify({ reason: "network_reconnect" }),
			headers: makeHeaders(target.token),
			method: "POST",
		}
	);
	if (!response.ok) {
		throw new Error(`chat retry rejected: ${response.status}`);
	}
}
