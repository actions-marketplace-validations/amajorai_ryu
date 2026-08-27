import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSession } from "@/lib/auth-client.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import { fetchAgent } from "@/src/lib/api/agents.ts";
import { fetchProfileStats } from "@/src/lib/api/profile.ts";
import type { SkillRelationAgent } from "@/src/lib/skill-relations.ts";

interface UseSkillRelationsOptions {
	agents: readonly AgentSummary[];
	enabled: boolean;
}

export interface SkillRelationsData {
	agents: SkillRelationAgent[];
	loading: boolean;
	usage: ReadonlyMap<string, number>;
	usageAvailable: boolean;
}

function fallbackAgent(agent: AgentSummary): SkillRelationAgent {
	return {
		description: agent.description,
		id: agent.id,
		name: agent.name,
		scopeUnavailable: true,
		skills: null,
	};
}

/**
 * Loads the optional inputs for the Skills relations graph. Configuration stays
 * node-scoped; profile stats are deliberately separate and account-scoped.
 */
export function useSkillRelations({
	agents,
	enabled,
}: UseSkillRelationsOptions): SkillRelationsData {
	const activeNode = useActiveNode();
	const { data: session } = useSession();
	const target = useMemo(
		() => ({
			token: activeNode.token ?? null,
			url: activeNode.url,
		}),
		[activeNode.token, activeNode.url]
	);
	const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);

	const agentScopesQuery = useQuery({
		enabled,
		queryKey: ["skills", "relations", "agents", target.url, agentIds],
		queryFn: async (): Promise<SkillRelationAgent[]> =>
			Promise.all(
				agents.map(async (agent) => {
					try {
						const record = await fetchAgent(target, agent.id);
						return {
							description: record.description,
							id: record.id,
							name: record.name,
							skills: record.skills,
						};
					} catch {
						return fallbackAgent(agent);
					}
				})
			),
	});

	const profileStatsQuery = useQuery({
		enabled: enabled && Boolean(session?.user?.id),
		queryKey: ["profile", "stats", session?.user?.id ?? null],
		queryFn: fetchProfileStats,
		staleTime: 60_000,
	});

	const fallbackScopes = useMemo(() => agents.map(fallbackAgent), [agents]);
	const usage = useMemo(
		() =>
			new Map(
				(profileStatsQuery.data?.insights.topSkills ?? []).map((entry) => [
					entry.id,
					entry.count,
				])
			),
		[profileStatsQuery.data]
	);

	return {
		agents: agentScopesQuery.data ?? fallbackScopes,
		loading: enabled && agentScopesQuery.isLoading,
		usage,
		usageAvailable: profileStatsQuery.isSuccess,
	};
}
