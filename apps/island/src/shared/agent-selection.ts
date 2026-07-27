// Shared AgentSelection shape for Island + desktop dictation prefs.
// Mirrors `apps/desktop/src/lib/api/preferences.ts` AgentSelection so the
// dictation preference blob can carry the same picker value the rest of the
// product uses (agent OR model + effort / thinking / access mode).

/** Full composer-style target: agent XOR model (+ optional effort/thinking/access). */
export interface AgentSelection {
	access_mode: string;
	agent_id: string;
	effort: string;
	model: string;
	provider: string;
	thinking_level: string;
}

/** All-unset selection — inherit the node default / fast local model. */
export const EMPTY_AGENT_SELECTION: AgentSelection = {
	access_mode: "",
	agent_id: "",
	effort: "",
	model: "",
	provider: "",
	thinking_level: "",
};

/** True when nothing is chosen. */
export function isAgentSelectionEmpty(selection: AgentSelection): boolean {
	return !(
		selection.agent_id ||
		selection.provider ||
		selection.model ||
		selection.thinking_level ||
		selection.effort ||
		selection.access_mode
	);
}

function selectionString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse a stored selection. Accepts the JSON object form, a legacy bare agent
 * id string under `{ agent }`, or a legacy bare model id.
 */
export function parseAgentSelection(value: unknown): AgentSelection {
	if (value == null) {
		return EMPTY_AGENT_SELECTION;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) {
			return EMPTY_AGENT_SELECTION;
		}
		if (!trimmed.startsWith("{")) {
			return { ...EMPTY_AGENT_SELECTION, model: trimmed };
		}
		try {
			return parseAgentSelection(JSON.parse(trimmed));
		} catch {
			return EMPTY_AGENT_SELECTION;
		}
	}
	if (typeof value !== "object") {
		return EMPTY_AGENT_SELECTION;
	}
	const parsed = value as Record<string, unknown>;
	return {
		agent_id: selectionString(parsed.agent_id),
		provider: selectionString(parsed.provider),
		model: selectionString(parsed.model),
		thinking_level: selectionString(parsed.thinking_level),
		effort: selectionString(parsed.effort),
		access_mode: selectionString(parsed.access_mode),
	};
}

/**
 * Prefer an explicit `selection` object; fall back to a legacy `agent` string
 * (Island dictation used to store only an agent id).
 */
export function parseAgentSelectionWithLegacyAgent(
	selection: unknown,
	legacyAgent: unknown
): AgentSelection {
	const fromSelection = parseAgentSelection(selection);
	if (!isAgentSelectionEmpty(fromSelection)) {
		return fromSelection;
	}
	const agent = selectionString(legacyAgent);
	if (agent.length > 0) {
		return { ...EMPTY_AGENT_SELECTION, agent_id: agent };
	}
	return EMPTY_AGENT_SELECTION;
}
