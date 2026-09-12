import type { AgentSummary } from "./api/agents.ts";

/** Returns true when the selected agent uses ACP transport (never touches the gateway). */
export function isAcpAgent(
	agentId: string | null,
	agents: readonly Pick<
		AgentSummary,
		"id" | "transport" | "builtIn" | "engine"
	>[]
): boolean {
	if (!agentId) {
		// No agent selected — default to ACP behaviour (no gateway needed).
		return true;
	}
	// Engine ids selected directly from the engines list (e.g. "acp:claude")
	if (agentId.startsWith("acp:")) {
		return true;
	}
	// Check against known agents in the registry
	const agent = agents.find((a) => a.id === agentId);
	if (!agent) {
		// Unknown id — default to ACP (no gateway required) to avoid false blocks.
		return true;
	}
	// Prefer the transport Core reports — the authoritative signal — over any
	// client-side re-derivation. Only "openai_compat" needs the gateway.
	if (agent.transport) {
		return agent.transport !== "openai_compat";
	}
	// Registry built-ins are always ACP
	if (agent.builtIn) {
		return true;
	}
	// Custom agents: if engine is explicitly set to an ACP variant, it's ACP
	if (agent.engine?.startsWith("acp:")) {
		return true;
	}
	// Custom agents with an explicit non-ACP engine or no engine: default to ACP
	// (openai-compat agents would have a non-null engine that does NOT start with "acp:")
	if (agent.engine && !agent.engine.startsWith("acp:")) {
		return false;
	}
	return true;
}

/**
 * Build the version-pager map (message id → { index, count, ids }) from a loaded
 * history. Only messages that actually have alternate versions (siblingCount > 1
 * with sibling ids) get an entry, so the pager renders solely at real branch
 * points.
 */
export function buildVersions(
	history: Array<{
		id: string;
		siblingIndex?: number;
		siblingCount?: number;
		siblingIds?: string[];
	}>
): Record<string, { index: number; count: number; ids: string[] }> {
	const map: Record<string, { index: number; count: number; ids: string[] }> =
		{};
	for (const h of history) {
		if (h.siblingCount && h.siblingCount > 1 && h.siblingIds?.length) {
			map[h.id] = {
				index: h.siblingIndex ?? 0,
				count: h.siblingCount,
				ids: h.siblingIds,
			};
		}
	}
	return map;
}

/** Plain text from the last assistant message's parts (for auto read-back). */
export function extractAssistantText(message: {
	parts?: unknown[];
	content?: string;
}): string {
	if (Array.isArray(message.parts) && message.parts.length > 0) {
		return message.parts
			.filter(
				(part): part is { type: string; text?: string } =>
					typeof part === "object" &&
					part !== null &&
					(part as { type?: string }).type === "text" &&
					typeof (part as { text?: string }).text === "string"
			)
			.map((part) => part.text ?? "")
			.join("\n\n")
			.trim();
	}
	return typeof message.content === "string" ? message.content.trim() : "";
}
