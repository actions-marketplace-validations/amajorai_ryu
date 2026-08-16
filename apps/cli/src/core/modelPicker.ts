import type { AcpConfig } from "@ryuhq/core-client/acp";
import type { AgentSummary } from "@ryuhq/core-client/agents";

export interface ModelPickerChoice {
	description?: string | null;
	id: string | null;
	label: string;
}

/** Build the picker rows from models advertised by the selected ACP agent. */
export function acpModelPickerChoices(config: AcpConfig): ModelPickerChoice[] {
	return (config.models?.availableModels ?? []).map((model) => ({
		id: model.modelId,
		label: model.name || model.modelId,
		description: model.description,
	}));
}

/** Build a stable fallback from the model values already present on agents. */
export function agentModelPickerChoices(
	agents: AgentSummary[],
	selectedAgentId?: string | null
): ModelPickerChoice[] {
	const source = selectedAgentId
		? agents.filter((agent) => agent.id === selectedAgentId)
		: agents;
	const seen = new Set<string>();
	const choices: ModelPickerChoice[] = [];
	for (const agent of source) {
		const model = agent.model?.trim();
		if (!model || seen.has(model)) {
			continue;
		}
		seen.add(model);
		choices.push({ id: model, label: model, description: agent.name });
	}
	return choices;
}

export function withDefaultModelChoice(
	choices: ModelPickerChoice[]
): ModelPickerChoice[] {
	return [
		{ id: null, label: "Default model", description: "Clear override" },
		...choices,
	];
}
