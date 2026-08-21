import type { AgentSummary } from "@/src/lib/api/agents.ts";

/** The engine id used by the agent setup picker for an installed built-in. */
export function agentEngineOptionId(agent: AgentSummary): string | null {
	if (!agent.builtIn) {
		return null;
	}
	return agent.id === "ryu" ? "acp:pi" : agent.id;
}

/** Resolve the picker engine back to the agent id shown in the universal picker. */
export function agentIdForEngine(
	engine: string | null | undefined,
	agents: AgentSummary[]
): string | null {
	const value = engine?.trim();
	if (!value) {
		return null;
	}

	const exact = agents.find(
		(agent) =>
			agentEngineOptionId(agent) === value ||
			agent.id === value ||
			agent.engine === value
	);
	if (exact) {
		return exact.id;
	}

	const withoutAcpPrefix = value.startsWith("acp:")
		? value.slice("acp:".length)
		: value;
	return (
		agents.find(
			(agent) =>
				agent.engine === withoutAcpPrefix || agent.id === withoutAcpPrefix
		)?.id ?? null
	);
}

/** Convert a universal-picker agent selection into the persisted engine slot. */
export function engineForAgentSelection(agent: AgentSummary): string {
	return agentEngineOptionId(agent) ?? agent.engine ?? agent.id;
}
