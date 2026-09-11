import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { personaToGlyphValue } from "@/src/lib/agent-persona.ts";
import {
	type Agent,
	type AgentInput,
	type AgentSummary,
	createAgent as apiCreateAgent,
	deleteAgent as apiDeleteAgent,
	updateAgent as apiUpdateAgent,
	fetchAgents,
} from "@/src/lib/api/agents.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	type ActiveEngine,
	type Engine,
	fetchActiveEngine,
	fetchEngines,
} from "@/src/lib/api/engines.ts";
import { useAgentsRefresh } from "@/src/lib/core-refresh.ts";
import { PlanCapError } from "@/src/lib/gating/planCapBridge.ts";
import { useEntityCap } from "@/src/lib/gating/useEntityCap.ts";
import { queryClient } from "@/src/lib/query-client.ts";
import { useActiveNode } from "./useActiveNode.ts";

export interface UseAgentsResult {
	activeEngine: ActiveEngine | null;
	agents: AgentSummary[];
	create: (input: AgentInput) => Promise<Agent>;
	engines: Engine[];
	error: string | null;
	loading: boolean;
	reload: () => Promise<void>;
	remove: (id: string) => Promise<void>;
	update: (id: string, input: AgentInput) => Promise<Agent>;
}

/// Collapse a full agent record (returned by create/update) into the lightweight
/// list summary so a mutation can update the in-memory list without a refetch.
function recordToSummary(agent: Agent): AgentSummary {
	return {
		id: agent.id,
		name: agent.name,
		avatarUrl: agent.persona?.avatar_url ?? null,
		avatarGlyph: personaToGlyphValue(agent.persona),
		description: agent.description,
		systemPrompt: agent.systemPrompt,
		engine: agent.engine,
		model: agent.model ?? agent.chatModel?.modelId ?? null,
		title: agent.title,
		installed: null,
		installHint: null,
		builtIn: agent.builtIn,
		createdAt: agent.createdAt,
		version: agent.version,
		latestVersion: null,
		versionStatus: null,
		locked: agent.locked,
		// Custom agents (the only records that flow through here) aren't backed
		// by a registry transport entry, and are never the flagship.
		transport: null,
		recommended: false,
		lifecycleStatus: agent.lifecycleStatus,
		safetyProfile: agent.safetyProfile,
	};
}

interface AgentRoster {
	activeEngine: ActiveEngine | null;
	agents: AgentSummary[];
	engines: Engine[];
}
const EMPTY_AGENTS: AgentSummary[] = [];
const EMPTY_ENGINES: Engine[] = [];

/// Loads agents and available engines from the active Core node and exposes CRUD
/// operations that keep the in-memory list in sync after each mutation, so the
/// chat picker reflects edits immediately. The list carries lightweight
/// summaries; the edit page fetches the full record (with tools) by id.
export function useAgents(): UseAgentsResult {
	const activeNode = useActiveNode();
	const target: ApiTarget = {
		url: activeNode.url,
		token: activeNode.token ?? null,
		userJwt: activeNode.userJwt ?? null,
	};
	const { url, token, userJwt } = target;

	const { guard, limitFor } = useEntityCap();

	const queryKey = useMemo(
		() => ["desktop-agent-roster", url, token, userJwt],
		[url, token, userJwt]
	);
	const query = useQuery(
		{
			queryKey,
			queryFn: async () => {
				const target: ApiTarget = { url, token, userJwt };
				const [agents, engines, activeEngine] = await Promise.all([
					fetchAgents(target),
					fetchEngines(target),
					fetchActiveEngine(target).catch(() => null),
				]);
				return { agents, engines, activeEngine };
			},
			staleTime: 30_000,
		},
		queryClient
	);
	const agents = query.data?.agents ?? EMPTY_AGENTS;
	const engines = query.data?.engines ?? EMPTY_ENGINES;
	const activeEngine = query.data?.activeEngine ?? null;
	const loading = query.isPending;
	const error = query.error?.message ?? null;
	const reload = useCallback(async () => {
		await queryClient.refetchQueries(
			{ queryKey, exact: true },
			{ cancelRefetch: false }
		);
	}, [queryKey]);
	// Global refresh already invalidates the shared query. Roster-only events
	// coalesce concurrent observers onto the same request as well.
	useAgentsRefresh(reload);
	const setAgents = useCallback(
		(update: (agents: AgentSummary[]) => AgentSummary[]) => {
			const hadRoster = queryClient.getQueryData(queryKey) !== undefined;
			queryClient.setQueryData<AgentRoster>(queryKey, (current) => ({
				agents: update(current?.agents ?? EMPTY_AGENTS),
				engines: current?.engines ?? EMPTY_ENGINES,
				activeEngine: current?.activeEngine ?? null,
			}));
			if (!hadRoster) {
				// A successful mutation can beat the initial list request. Publish its
				// result immediately, then recover the rest of the roster in the background.
				void queryClient.invalidateQueries({ queryKey, exact: true });
			}
		},
		[queryKey]
	);

	const create = useCallback(
		async (input: AgentInput) => {
			// Managed-path numeric cap (free tier). Blocks + opens the upgrade modal
			// when at the limit; a no-op off the managed path (self-host uncapped).
			if (!guard("maxAgents", agents.length)) {
				throw new PlanCapError("maxAgents", limitFor("maxAgents"));
			}
			const agent = await apiCreateAgent({ url, token, userJwt }, input);
			await queryClient.cancelQueries({ queryKey, exact: true });
			setAgents((prev) => [recordToSummary(agent), ...prev]);
			return agent;
		},
		[url, token, userJwt, guard, limitFor, agents.length, setAgents, queryKey]
	);

	const update = useCallback(
		async (id: string, input: AgentInput) => {
			const agent = await apiUpdateAgent({ url, token, userJwt }, id, input);
			await queryClient.cancelQueries({ queryKey, exact: true });
			setAgents((prev) =>
				prev.map((a) => (a.id === id ? { ...a, ...recordToSummary(agent) } : a))
			);
			return agent;
		},
		[url, token, userJwt, setAgents, queryKey]
	);

	const remove = useCallback(
		async (id: string) => {
			await apiDeleteAgent({ url, token, userJwt }, id);
			await queryClient.cancelQueries({ queryKey, exact: true });
			setAgents((prev) => prev.filter((a) => a.id !== id));
		},
		[url, token, userJwt, setAgents, queryKey]
	);

	return {
		agents,
		engines,
		activeEngine,
		loading,
		error,
		reload,
		create,
		update,
		remove,
	};
}
