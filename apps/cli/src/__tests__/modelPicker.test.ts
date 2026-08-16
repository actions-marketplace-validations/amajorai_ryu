import { expect, test } from "bun:test";
import type { AcpConfig } from "@ryuhq/core-client/acp";
import type { AgentSummary } from "@ryuhq/core-client/agents";
import {
	acpModelPickerChoices,
	agentModelPickerChoices,
	withDefaultModelChoice,
} from "../core/modelPicker.ts";

const acpConfig: AcpConfig = {
	modes: null,
	configOptions: null,
	models: {
		currentModelId: "sonnet",
		availableModels: [
			{ modelId: "sonnet", name: "Claude Sonnet", description: "Balanced" },
			{ modelId: "haiku", name: "Claude Haiku" },
		],
	},
};

test("uses models advertised by the ACP agent", () => {
	expect(acpModelPickerChoices(acpConfig)).toEqual([
		{ id: "sonnet", label: "Claude Sonnet", description: "Balanced" },
		{ id: "haiku", label: "Claude Haiku", description: undefined },
	]);
});

test("falls back to the selected agent's configured model", () => {
	const agents = [
		{ id: "a", name: "Claude", model: "sonnet" },
		{ id: "b", name: "OpenAI", model: "gpt-5" },
	] as AgentSummary[];
	expect(agentModelPickerChoices(agents, "a")).toEqual([
		{ id: "sonnet", label: "sonnet", description: "Claude" },
	]);
});

test("deduplicates fallback models and adds a clear/default row", () => {
	const agents = [
		{ id: "a", name: "One", model: "shared" },
		{ id: "b", name: "Two", model: "shared" },
		{ id: "c", name: "Empty", model: " " },
	] as AgentSummary[];
	expect(withDefaultModelChoice(agentModelPickerChoices(agents))).toEqual([
		{ id: null, label: "Default model", description: "Clear override" },
		{ id: "shared", label: "shared", description: "One" },
	]);
});
