import type { ComposerSettingItem } from "@/components/agent-elements/input/composer-settings-menu.tsx";

/** OpenRouter's general-purpose model router. */
export const OPENROUTER_AUTO_MODEL_ID = "openrouter/auto";

/** OpenRouter's coding-focused Pareto router. */
export const OPENROUTER_PARETO_CODE_MODEL_ID = "openrouter/pareto-code";

const ROUTER_MODEL_LABELS: Record<
	string,
	{ description: string; name: string }
> = {
	[OPENROUTER_AUTO_MODEL_ID]: {
		name: "Auto Router",
		description: "OpenRouter picks a strong model for each task.",
	},
	[OPENROUTER_PARETO_CODE_MODEL_ID]: {
		name: "Auto Code",
		description: "OpenRouter picks a coding model with its Pareto router.",
	},
};

/**
 * Give upstream router model ids a readable label while preserving any richer
 * name returned by live provider discovery.
 */
export function modelMenuItem(
	id: string,
	discoveredName?: string | null
): ComposerSettingItem {
	const metadata = ROUTER_MODEL_LABELS[id];
	const suppliedName = discoveredName?.trim();
	return {
		description: metadata?.description,
		id,
		name:
			suppliedName && suppliedName !== id
				? suppliedName
				: (metadata?.name ?? id),
	};
}
