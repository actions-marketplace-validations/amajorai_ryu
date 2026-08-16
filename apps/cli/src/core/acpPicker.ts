import { type AcpConfig, flattenConfigOptions } from "@ryuhq/core-client/acp";

export type AcpPickerChoice =
	| { kind: "mode"; id: string; label: string; description?: string | null }
	| {
			kind: "config";
			configId: string;
			id: string;
			label: string;
			description?: string | null;
	  };

export function acpPickerChoices(config: AcpConfig): AcpPickerChoice[] {
	const modes = (config.modes?.availableModes ?? []).map((mode) => ({
		kind: "mode" as const,
		id: mode.id,
		label: mode.name,
		description: mode.description,
	}));
	const options = (config.configOptions ?? []).flatMap((option) =>
		flattenConfigOptions(option).map((value) => ({
			kind: "config" as const,
			configId: option.id,
			id: value.value,
			label: `${option.name}: ${value.name}`,
			description: value.description,
		}))
	);
	return [...modes, ...options];
}

export function applyAcpPickerChoice(
	choice: AcpPickerChoice,
	current: { mode: string | null; config: Record<string, string> }
): { mode: string | null; config: Record<string, string> } {
	if (choice.kind === "mode") {
		return { ...current, mode: choice.id };
	}
	return {
		...current,
		config: { ...current.config, [choice.configId]: choice.id },
	};
}
