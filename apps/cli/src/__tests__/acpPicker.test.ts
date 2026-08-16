import { expect, test } from "bun:test";
import type { AcpConfig } from "@ryuhq/core-client/acp";
import { acpPickerChoices, applyAcpPickerChoice } from "../core/acpPicker.ts";

const config: AcpConfig = {
	modes: {
		currentModeId: "plan",
		availableModes: [
			{ id: "plan", name: "Plan" },
			{ id: "edit", name: "Edit" },
		],
	},
	models: null,
	configOptions: [
		{
			id: "thought_level",
			name: "Reasoning",
			category: "thoughtLevel",
			options: [
				{ value: "low", name: "Low" },
				{ value: "high", name: "High", description: "More deliberate" },
			],
		},
	],
};

test("flattens agent-reported modes and reasoning options", () => {
	expect(
		acpPickerChoices(config).map(({ kind, id, label }) => ({ kind, id, label }))
	).toEqual([
		{ kind: "mode", id: "plan", label: "Plan" },
		{ kind: "mode", id: "edit", label: "Edit" },
		{ kind: "config", id: "low", label: "Reasoning: Low" },
		{ kind: "config", id: "high", label: "Reasoning: High" },
	]);
});

test("applies mode and config choices independently", () => {
	const mode = applyAcpPickerChoice(
		{ kind: "mode", id: "edit", label: "Edit" },
		{ mode: "plan", config: { thought_level: "low" } }
	);
	const next = applyAcpPickerChoice(
		{
			kind: "config",
			configId: "thought_level",
			id: "high",
			label: "Reasoning: High",
		},
		mode
	);
	expect(next).toEqual({ mode: "edit", config: { thought_level: "high" } });
});
