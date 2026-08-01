"use client";

// The desktop binding of the shared composer ACP-sections derivation
// (`@ryu/blocks/composer/composer-acp-sections`) — the Model selector and the
// "thinking"/approval + agent-advertised config selectors, from an agent's
// advertised session config (`useAcpConfig`, keyed by agentId, NOT a live chat
// session). ChatPage, the launchpad, and the Ask Ryu dock all call this and feed
// its `modelSection` / `extraSections` straight into `useComposerAgentControls`,
// so every surface shows the SAME Agent · Model · Thinking dropdown — even before
// a chat exists.
//
// Everything common with the island's composer (the dedup rules, the
// `acpMode`/`acpModel`/`acpOptionValues` state machine, the per-agent
// seeding/reset, and adoption of Core's two streamed write-back channels) lives
// in the shared primitive. What is bound here is what only the desktop has:
//
//   - persistence (`src/lib/acp-selections.ts` → `ACP_SELECTION_STORE`);
//   - friendly-mode model display names;
//   - the per-agent enabled-model overrides from the Pi catalog;
//   - the grouped/searchable model submenu with installed-model merge and
//     per-model subscription quotas;
//   - the "Detecting…" loading state while an ACP agent's config is probed;
//   - the reasoning-off capability override that suppresses the thinking picker.
//
// Selections persist per-agent to localStorage (the same store the spawned chat
// reads on `session/new`), so a model/mode picked on the launchpad is honoured by
// the new chat. ChatPage additionally reads the returned effective values
// (`acpMode` / `acpModel` / `acpOptionValues`) onto its per-turn request body.

import type {
	AcpSectionsResult,
	AcpSelectionStore,
	ComposerModelSection,
	StreamedAcpConfig,
} from "@ryu/blocks/composer/composer-acp-sections";
import { useAcpSections } from "@ryu/blocks/composer/composer-acp-sections";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ComposerSettingItem } from "@/components/agent-elements/input/composer-settings-menu.tsx";
import {
	groupModelItems,
	mergeInstalledModels,
} from "@/components/agent-elements/input/model-groups.ts";
import { createModelMenuRenderer } from "@/components/agent-elements/input/model-menu-content.tsx";
import type { ModelOption } from "@/components/agent-elements/types.ts";
import { useAcpConfig } from "@/src/hooks/useAcpConfig.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useAgentCapabilities } from "@/src/hooks/useAgentCapabilities.ts";
import { useFriendlyMode } from "@/src/hooks/useFriendlyMode.ts";
import { usePiConfig } from "@/src/hooks/usePiConfig.ts";
import {
	getAcpConfig,
	getAcpMode,
	getAcpModel,
	setAcpConfigValue,
	setAcpMode,
	setAcpModel,
} from "@/src/lib/acp-selections.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import { getActiveModel, listInstalledModels } from "@/src/lib/api/models.ts";
import { filterEnabledModels } from "@/src/lib/api/pi-config.ts";
import { friendlyModelDisplay } from "@/src/lib/catalog/friendly.ts";

/**
 * The desktop's localStorage-backed persistence, as the shared hook's injected
 * store. Module-level so its identity is stable across renders (the hook lists
 * it as an effect/callback dependency).
 */
const ACP_SELECTION_STORE: AcpSelectionStore = {
	getAcpConfig,
	getAcpMode,
	getAcpModel,
	setAcpConfigValue,
	setAcpMode,
	setAcpModel,
};

/** Flat model rows → grouped, searchable submenu (Pi lists are long). */
function withGroupedModelMenu(
	section: ComposerModelSection,
	installedStems: string[],
	activeStem?: string | null,
	/**
	 * The subscription agent whose per-model quotas the rows should show. Null for
	 * Ryu (Gateway-routed models have no vendor window) and for any agent with no
	 * readable subscription usage.
	 */
	usageAgentId?: string | null
): ComposerModelSection {
	if (section.items.length === 0) {
		return section;
	}
	const merged = mergeInstalledModels(
		section.items,
		installedStems,
		activeStem
	);
	const grouped = groupModelItems(merged);
	return {
		...section,
		items: merged,
		renderContent: createModelMenuRenderer(
			grouped,
			section.value,
			usageAgentId
		),
	};
}

export interface ComposerAcpSectionsParams {
	/** The active agent (drives the advertised config + ACP detection). */
	agentId: string | null;
	/** Live agent registry — used only to detect the active agent's transport. */
	agents: AgentSummary[];
	/** Effective engine model id (for the non-ACP fallback picker). */
	engineModel: string | null;
	/** Engine-catalog model options — the fallback picker for non-ACP agents. */
	modelOptions: ModelOption[];
	/** Persist an engine-catalog model pick (non-ACP fallback). */
	onEngineModelChange: (modelId: string) => void;
	/**
	 * Session-config values the AGENT asked the client to update, observed on the
	 * live chat stream (Core's `data-ryu-acp-config` part). Session-scoped
	 * surfaces (launchpad/dock) leave this undefined. See the shared primitive.
	 */
	streamedConfig?: StreamedAcpConfig | null;
	/**
	 * An agent-INITIATED permission-mode change observed on the live chat stream
	 * (Core's `data-ryu-acp-mode` part). Session-scoped surfaces leave it undefined.
	 */
	streamedMode?: string | null;
}

export interface ComposerAcpSectionsResult
	extends Omit<AcpSectionsResult, "activeAgentIsAcp"> {
	/** Whether the active agent's reasoning is overridden off (hides thinking picker). */
	reasoningOff: boolean;
}

/**
 * Builds the composer's Model + Approval + config picker sections from the active
 * agent's advertised ACP session config. Session-independent (works on the
 * launchpad and dock before any chat exists); picks persist per-agent.
 */
export function useComposerAcpSections({
	agentId,
	agents,
	modelOptions,
	engineModel,
	onEngineModelChange,
	streamedMode,
	streamedConfig,
}: ComposerAcpSectionsParams): ComposerAcpSectionsResult {
	const activeNode = useActiveNode();
	const isRyuAgent = agentId === "ryu";

	const installedQuery = useQuery({
		queryKey: ["models", "installed", activeNode.url],
		queryFn: () =>
			listInstalledModels({
				url: activeNode.url,
				token: activeNode.token ?? null,
			}),
		enabled: isRyuAgent,
		staleTime: 60_000,
	});
	const activeModelQuery = useQuery({
		queryKey: ["models", "active", activeNode.url],
		queryFn: () =>
			getActiveModel({
				url: activeNode.url,
				token: activeNode.token ?? null,
			}),
		enabled: isRyuAgent,
		staleTime: 30_000,
	});
	const installedStems = useMemo(
		() => (installedQuery.data ?? []).map((m) => m.stem).filter(Boolean),
		[installedQuery.data]
	);
	// The active agent's per-model visibility, from the same Pi catalog the
	// provider rows read (shared query key ⇒ no extra request). An agent's models
	// come over ACP, so this is the only place its toggles can be applied.
	const { catalog: piCatalog } = usePiConfig();
	const agentModelOverrides = agentId
		? piCatalog?.agentModelOverrides?.[agentId]
		: undefined;
	const activeStem = activeModelQuery.data?.active ?? null;

	// The active agent's advertised permission modes / reasoning-effort config
	// options / models. A picker renders only for what the agent reports.
	const { config: acpSessionConfig, loading: acpConfigLoading } =
		useAcpConfig(agentId);
	// The active agent's effective capabilities — a reasoning-off override
	// suppresses the thinking picker (Jan-style). Pass the engine model so
	// vision/tools detection follows the composer's model selection.
	const { capabilities } = useAgentCapabilities(agentId, engineModel);
	const reasoningOff = capabilities?.reasoning === false;

	const [friendly] = useFriendlyMode();
	const modelDisplayName = useCallback(
		(raw: string) => (friendly ? friendlyModelDisplay(raw).label : raw),
		[friendly]
	);
	// The active agent's per-model visibility overrides (Settings → Providers →
	// Agents). Applies to whichever model branch wins: an agent advertises its
	// models over ACP rather than through a Pi provider, so a provider's
	// `modelOverrides` never covers this list. The branch's own current value is
	// always kept, so a hidden-but-selected model never vanishes.
	const filterModelItems = useCallback(
		(items: ComposerSettingItem[], current: string | null | undefined) =>
			filterEnabledModels(items, agentModelOverrides, current),
		[agentModelOverrides]
	);

	const {
		acpMode,
		acpModel,
		acpOptionValues,
		activeAgentIsAcp,
		extraSections,
		modelSection,
	} = useAcpSections({
		acpSessionConfig,
		agentId,
		agents,
		engineModel,
		filterModelItems,
		modelDisplayName,
		modelOptions,
		onEngineModelChange,
		reasoningOff,
		store: ACP_SELECTION_STORE,
		streamedConfig,
		streamedMode,
	});

	return useMemo<ComposerAcpSectionsResult>(() => {
		// While an ACP agent's advertised config is still being probed (`useAcpConfig`
		// spawns the agent subprocess on first fetch, up to ~30s + retries), mark the
		// section loading so the composer shows a "Detecting…" spinner instead of
		// silently hiding an empty picker — the "selectors just missing on agent
		// switch, no loading state" gap.
		const decorated: ComposerModelSection = {
			...withGroupedModelMenu(
				modelSection,
				isRyuAgent ? installedStems : [],
				isRyuAgent ? activeStem : null,
				// Only an external ACP harness runs on its own vendor subscription, so
				// only its models can carry a per-model quota.
				activeAgentIsAcp ? agentId : null
			),
			loading: activeAgentIsAcp && acpConfigLoading,
		};
		return {
			modelSection: decorated,
			extraSections,
			acpMode,
			acpModel,
			acpOptionValues,
			reasoningOff,
		};
	}, [
		acpMode,
		acpModel,
		acpOptionValues,
		acpConfigLoading,
		activeAgentIsAcp,
		agentId,
		activeStem,
		extraSections,
		installedStems,
		isRyuAgent,
		modelSection,
		reasoningOff,
	]);
}
