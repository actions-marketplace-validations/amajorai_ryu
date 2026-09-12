import { queryOptions } from "@tanstack/react-query";
import { fetchAgents } from "./api/agents.ts";
import type { ApiTarget } from "./api/client.ts";

export const AGENT_LIST_KEY = "desktop-agent-list";

/** Chat, Library and MCP pickers share one cancellable, credential-scoped read. */
export function agentListOptions(target: ApiTarget) {
	return queryOptions({
		queryKey: [
			AGENT_LIST_KEY,
			target.url,
			target.token ?? null,
			target.userJwt ?? null,
		] as const,
		queryFn: ({ signal }) => fetchAgents(target, signal),
		staleTime: 30_000,
		retry: false,
	});
}
