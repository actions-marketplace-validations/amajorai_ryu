// The node-wide default agent — the LAST link in the composer's seed chain.
//
// The value is Core's `default-agent-selection` preference (see
// `apps/core/src/agent_selection.rs`), the one place a node says "when nothing
// else is configured, use this agent/model". It is edited in the Gateway dialog
// → Defaults and already inherited by plugins and Core's own side-model
// consumers; the chat composer used to be the one surface that ignored it and
// fell back to the `ryu_default_agent` localStorage hint alone. That hint is a
// "last agent I picked" convenience, not a configured default, so on a fresh
// profile the composer opened on whatever `agents[0]` happened to be rather
// than on the node's declared choice.
//
// Only `agent_id` is read here. The rest of the selection (provider, model,
// thinking, effort, access mode) is consumed by Core-side resolvers; the
// composer's model already follows the agent through the per-agent
// `getAgentModel` table, so re-applying a default model client-side would be a
// second, competing source for the same value.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	DEFAULT_AGENT_SELECTION_PREF_KEY,
	getAgentSelection,
} from "@/src/lib/api/preferences.ts";
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
		queryKey: ["node-default-agent-selection", node.url],
		queryFn: () => getAgentSelection(target, DEFAULT_AGENT_SELECTION_PREF_KEY),
		// A node-wide preference changes about as often as a setting is edited;
		// every chat tab mounts this hook, so serve them all from one cached read.
		staleTime: 5 * 60 * 1000,
	});
	// `AgentSelection` spells "unset" as the empty string, not null.
	const agentId = data?.agent_id ?? "";
	return agentId === "" ? null : agentId;
}
