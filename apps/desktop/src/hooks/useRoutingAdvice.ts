// apps/desktop/src/hooks/useRoutingAdvice.ts
//
// What the next turn would actually run, given how much headroom is left —
// Core's threshold fallback verdict for the agent/model the composer currently
// has selected. Backs the composer info bar.
//
// Refetched whenever the selection changes AND on every turn (the composer calls
// `refresh()` after sending), which is what the feature promises: "check my
// balance each time I send". That is affordable because the *signals* are cached
// in Core with per-source TTLs, not because the check is skipped — the request
// is a preference read plus arithmetic against a cached snapshot.
//
// Failure is silent by design. A routing check that cannot be made must not
// annotate or block a turn, so a rejected query leaves the bar empty rather than
// showing an error the user can do nothing about.

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RoutingAdvice } from "@/src/lib/api/routing.ts";
import { fetchRoutingAdvice } from "@/src/lib/api/routing.ts";
import { useActiveNode } from "./useActiveNode.ts";

/** Keep the verdict fresh for a minute; sending a turn refreshes it anyway. */
const ONE_MINUTE_MS = 1000 * 60;

export interface RoutingAdviceState {
	advice: RoutingAdvice | null;
	/** Re-ask Core. Call after sending a turn so the bar reflects the new spend. */
	refresh: () => void;
}

/**
 * The fallback verdict for `agentId` + `model`, or `null` when there is nothing
 * to say (no rules configured, unknown signals, or the query failed).
 *
 * `atConversationStart` gates the heavier agent-swapping rules — pass true when
 * the composer would open a thread rather than continue one.
 */
export function useRoutingAdvice(
	agentId: string | null,
	model: string | null,
	atConversationStart: boolean
): RoutingAdviceState {
	const node = useActiveNode();
	const { data, refetch } = useQuery({
		queryKey: ["routing-advice", node.url, agentId, model, atConversationStart],
		queryFn: () =>
			fetchRoutingAdvice(
				{ url: node.url, token: node.token, userJwt: node.userJwt ?? null },
				agentId ?? "",
				model ?? "",
				atConversationStart
			),
		enabled: Boolean(agentId),
		staleTime: ONE_MINUTE_MS,
		// No polling: headroom only moves when a turn spends it, and a turn calls
		// `refresh()` itself. A background interval would ask on an idle window
		// forever for no new information.
		refetchOnWindowFocus: false,
		retry: false,
	});

	const refresh = useCallback(() => {
		void refetch();
	}, [refetch]);

	// `continue` is the overwhelmingly common verdict and means "say nothing";
	// collapsing it to null here keeps every consumer from re-checking.
	const advice = data && data.severity !== "continue" ? data : null;
	return { advice, refresh };
}
