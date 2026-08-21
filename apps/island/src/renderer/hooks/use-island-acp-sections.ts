// The island binding of the shared composer ACP-sections derivation
// (`@ryu/blocks/composer/composer-acp-sections`) — the same primitive the desktop
// composer binds, so the two can no longer drift apart. It builds the Model +
// Approval + agent-advertised config sections from the active agent's advertised
// session config and owns the per-agent selections.
//
// The island binds only what is island-specific: persistence
// (`renderer/lib/acp-selections.ts`) and the two streamed write-back channels,
// which arrive here as plain values pushed by `useIslandChat` off the Core stream
// (`data-ryu-acp-config` / `data-ryu-acp-mode`) rather than being derived from a
// message list. Adopting the config channel is what stops an approved plan from
// re-entering plan mode on the very next turn.
//
// No friendly-mode names, per-model visibility overrides, grouped model submenu
// or "Detecting…" loading state: those are desktop chrome the island does not
// render, and the shared primitive defaults them off.

import type {
	AcpSectionsResult,
	AcpSelectionStore,
	StreamedAcpConfig,
} from "@ryu/blocks/composer/composer-acp-sections";
import { useAcpSections } from "@ryu/blocks/composer/composer-acp-sections";
import type { ModelOption } from "@ryu/blocks/composer/types";
import type { AcpConfig } from "../../shared/acp.ts";
import type { CoreAgentSummary } from "../../shared/ipc.ts";
import {
	getAcpConfig,
	getAcpMode,
	getAcpModel,
	setAcpConfigValue,
	setAcpMode,
	setAcpModel,
} from "../lib/acp-selections.ts";

/**
 * The island's localStorage-backed persistence, as the shared hook's injected
 * store. Module-level so its identity is stable across renders (the hook lists it
 * as an effect/callback dependency).
 */
const ACP_SELECTION_STORE: AcpSelectionStore = {
	getAcpConfig,
	getAcpMode,
	getAcpModel,
	setAcpConfigValue,
	setAcpMode,
	setAcpModel,
};

export interface IslandAcpSectionsParams {
	acpSessionConfig: AcpConfig | null;
	agentId: string | null;
	agents: CoreAgentSummary[];
	engineModel: string | null;
	modelOptions: ModelOption[];
	onEngineModelChange: (modelId: string) => void;
	/**
	 * The newest agent-requested session-config write-back seen on the live Core
	 * stream, tagged with the emission identity of the part that carried it. Null
	 * until one arrives. See the shared primitive for why the key, not the value,
	 * is the dedupe identity.
	 */
	streamedConfig?: StreamedAcpConfig | null;
	/** The newest agent-initiated permission-mode switch seen on the live stream. */
	streamedMode?: string | null;
}

export type IslandAcpSectionsResult = Omit<
	AcpSectionsResult,
	"activeAgentIsAcp"
>;

export function useIslandAcpSections({
	agentId,
	agents,
	acpSessionConfig,
	engineModel,
	modelOptions,
	onEngineModelChange,
	streamedConfig,
	streamedMode,
}: IslandAcpSectionsParams): IslandAcpSectionsResult {
	const {
		acpMode,
		acpModel,
		acpOptionValues,
		extraSections,
		modelSection,
		simpleApprovalDefaults,
	} = useAcpSections({
		acpSessionConfig,
		agentId,
		agents,
		engineModel,
		modelOptions,
		onEngineModelChange,
		// Not a mystery constant: the island has never rendered a thinking /
		// reasoning-effort picker — it filtered those options out
		// unconditionally. The desktop hides them only when the agent's
		// capabilities report reasoning overridden off, but that probe is a
		// Core-backed desktop hook the island has no path to. Hardcoding `true`
		// keeps the island's pre-extraction behaviour exactly; true parity needs
		// an island-side capability probe, and only then should this go away.
		reasoningOff: true,
		store: ACP_SELECTION_STORE,
		streamedConfig,
		streamedMode,
	});

	return {
		acpMode,
		acpModel,
		acpOptionValues,
		extraSections,
		modelSection,
		simpleApprovalDefaults,
	};
}
