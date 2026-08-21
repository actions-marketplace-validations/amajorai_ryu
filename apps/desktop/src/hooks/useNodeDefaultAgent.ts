// The node-wide default agent — the last link in the composer's seed chain.
// Normal chats prefer the configured cloud lane and fall back to the local
// lane. Core resolves the complete selection at request time; the composer
// only needs the agent id to choose the right picker surface.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import { getLaneAgentSelection } from "@/src/lib/api/preferences.ts";
import { useActiveNode } from "./useActiveNode.ts";

/**
 * The node's configured default agent id, or null when none is set (the common
 * case) or while the preference is still being fetched.
 *
 * Callers must treat a late `null → id` transition as "fill a hole", never as a
 * retarget — see `shouldAdoptNodeDefault` in `lib/composer-target.ts`.
 */
export function useNodeDefaultAgentId(): string | null {
	const node = useActiveNode();
	const target = useMemo(() => toTarget(node), [node]);
	const { data } = useQuery({
		queryKey: ["node-default-agent-selections", node.url],
		queryFn: () =>
			Promise.all([
				getLaneAgentSelection(target, "local"),
				getLaneAgentSelection(target, "cloud"),
			]),
		// A node-wide preference changes about as often as a setting is edited;
		// every chat tab mounts this hook, so serve them all from one cached read.
		staleTime: 5 * 60 * 1000,
	});
	// `AgentSelection` spells "unset" as the empty string, not null.
	const cloudAgentId = data?.[1]?.agent_id ?? "";
	const localAgentId = data?.[0]?.agent_id ?? "";
	const agentId = cloudAgentId || localAgentId;
	return agentId === "" ? null : agentId;
}
