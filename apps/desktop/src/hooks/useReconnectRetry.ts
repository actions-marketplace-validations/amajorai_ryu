import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { hasPluginChatFeature } from "@/src/lib/plugin-chat-features.ts";
import {
	CHAT_RETRY_STARTED_EVENT,
	fetchRuns,
	loadRetryCandidates,
	mergeOutageCandidates,
	RECONNECT_RETRY_FEATURE_KIND,
	RECONNECT_RETRY_PLUGIN_ID,
	reconnectRetryStorageKey,
	retryConversation,
	saveRetryCandidates,
	selectPendingRetries,
} from "@/src/lib/reconnect-retry.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import { useRuns } from "./useRuns.ts";

export type ReconnectRetryPhase =
	| "idle"
	| "offline"
	| "retrying"
	| "complete"
	| "error";

export interface ReconnectRetryState {
	candidateCount: number;
	failedCount: number;
	phase: ReconnectRetryPhase;
	retriedCount: number;
}

export const EMPTY_RECONNECT_RETRY_STATE: ReconnectRetryState = {
	candidateCount: 0,
	failedCount: 0,
	phase: "idle",
	retriedCount: 0,
};

const TRANSIENT_STATUS_MS = 6000;
const RECONNECT_RETRY_PROBE_MS = 2000;

function browserIsOnline(): boolean {
	return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * Own the desktop half of the opt-in reconnect-retry feature. The hook is
 * mounted once by Layout, so it can observe all background runs rather than only
 * the focused ChatPage.
 */
export function useReconnectRetry(): ReconnectRetryState {
	const activeNode = useActiveNode();
	const { runs } = useRuns();
	const { chat_features: chatFeatures } = usePluginContributions();
	const enabled = hasPluginChatFeature(
		chatFeatures,
		RECONNECT_RETRY_PLUGIN_ID,
		RECONNECT_RETRY_FEATURE_KIND
	);
	const activeNodeOnline = useNodeStore((state) => state.activeNodeOnline);
	const probeActiveNode = useNodeStore((state) => state.probeActiveNode);
	const [browserOnline, setBrowserOnline] = useState(browserIsOnline);
	const [state, setState] = useState<ReconnectRetryState>(
		EMPTY_RECONNECT_RETRY_STATE
	);
	const outageActive = useRef(false);
	const retryInFlight = useRef(false);
	const transientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const storageKey = useMemo(
		() => reconnectRetryStorageKey(activeNode.url),
		[activeNode.url]
	);

	const showTransient = useCallback((next: ReconnectRetryState) => {
		setState(next);
		if (transientTimer.current) {
			clearTimeout(transientTimer.current);
		}
		transientTimer.current = setTimeout(() => {
			setState(EMPTY_RECONNECT_RETRY_STATE);
			transientTimer.current = null;
		}, TRANSIENT_STATUS_MS);
	}, []);

	const captureOutage = useCallback(() => {
		const queued = mergeOutageCandidates(loadRetryCandidates(storageKey), runs);
		saveRetryCandidates(storageKey, queued);
		outageActive.current = true;
		if (queued.length > 0) {
			setState({
				candidateCount: queued.length,
				failedCount: 0,
				phase: "offline",
				retriedCount: 0,
			});
		}
	}, [runs, storageKey]);

	const retryPending = useCallback(async () => {
		if (retryInFlight.current) {
			return;
		}
		const candidates = loadRetryCandidates(storageKey);
		if (candidates.length === 0) {
			return;
		}
		retryInFlight.current = true;
		const target = {
			token: activeNode.token ?? null,
			userJwt: activeNode.userJwt ?? null,
			url: activeNode.url,
		};
		try {
			const currentRuns = await fetchRuns(target);
			const selection = selectPendingRetries(candidates, currentRuns);
			saveRetryCandidates(storageKey, selection.retained);
			if (selection.retry.length === 0) {
				return;
			}

			setState({
				candidateCount: selection.retry.length,
				failedCount: 0,
				phase: "retrying",
				retriedCount: 0,
			});
			const results = await Promise.allSettled(
				selection.retry.map((candidate) =>
					retryConversation(target, candidate.conversationId)
				)
			);
			let retriedCount = 0;
			let failedCount = 0;
			for (const [index, result] of results.entries()) {
				if (result.status === "fulfilled") {
					retriedCount += 1;
					if (typeof window !== "undefined") {
						window.dispatchEvent(
							new CustomEvent(CHAT_RETRY_STARTED_EVENT, {
								detail: {
									conversationId: selection.retry[index].conversationId,
									source: "reconnect-retry",
								},
							})
						);
					}
				} else {
					failedCount += 1;
				}
			}
			showTransient({
				candidateCount: selection.retry.length,
				failedCount,
				phase: failedCount === 0 ? "complete" : "error",
				retriedCount,
			});
		} catch {
			// Keep the candidate for the next genuine outage transition. A node
			// that answered one probe can still reject the first request while its
			// HTTP listener is warming up.
			saveRetryCandidates(storageKey, candidates);
			showTransient({
				candidateCount: candidates.length,
				failedCount: candidates.length,
				phase: "error",
				retriedCount: 0,
			});
		} finally {
			retryInFlight.current = false;
		}
	}, [activeNode, showTransient, storageKey]);

	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}
		const onOnline = () => {
			setBrowserOnline(true);
			probeActiveNode().catch(() => undefined);
		};
		const onOffline = () => setBrowserOnline(false);
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		return () => {
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
		};
	}, [enabled, probeActiveNode]);

	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}
		const timer = window.setInterval(() => {
			if (outageActive.current) {
				probeActiveNode().catch(() => undefined);
			}
		}, RECONNECT_RETRY_PROBE_MS);
		return () => window.clearInterval(timer);
	}, [enabled, probeActiveNode]);

	useEffect(() => {
		if (!enabled) {
			outageActive.current = false;
			setState(EMPTY_RECONNECT_RETRY_STATE);
			return;
		}
		const connectionDown = !browserOnline || activeNodeOnline === false;
		if (connectionDown) {
			captureOutage();
			return;
		}
		if (!outageActive.current) {
			return;
		}
		outageActive.current = false;
		void retryPending();
	}, [activeNodeOnline, browserOnline, captureOutage, enabled, retryPending]);

	useEffect(
		() => () => {
			if (transientTimer.current) {
				clearTimeout(transientTimer.current);
			}
		},
		[]
	);

	return enabled ? state : EMPTY_RECONNECT_RETRY_STATE;
}
