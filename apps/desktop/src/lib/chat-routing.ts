import type { InterfaceLevel } from "./interface-level.ts";

export interface SimpleApprovalDefaults {
	config: Record<string, string>;
	mode: string | null;
}

/** The per-turn routing pins the composer may have selected. */
export interface ChatRoutingSelections {
	acpConfig?: Record<string, string> | null;
	acpMode?: string | null;
	acpModel?: string | null;
	model?: string | null;
	simpleApprovalDefaults?: SimpleApprovalDefaults | null;
}

/** Fields that are safe to send for the current surface level. */
export interface ChatRoutingFields {
	acp_config?: Record<string, string>;
	acp_mode?: string;
	acp_model?: string;
	model?: string;
}

/** Presentation mode sent to Core for the flagship Ryu assistant. */
export type ChatResponseMode = "everyday" | "developer";

/** Map the Desktop's user-facing interface level to the chat vocabulary. */
export function responseModeForInterface(
	level: InterfaceLevel
): ChatResponseMode {
	return level === "expert" ? "developer" : "everyday";
}

/**
 * Ryu Work is intentionally agent-first: the user can choose the agent, while
 * Core owns model selection and routing. Keeping the local selections in place
 * lets a user switch to Code without losing their preferences, but hidden
 * model/effort pins must not leak into a Ryu Work request. The only hidden
 * values Ryu Work may send are safe ACP permission defaults derived from
 * the active agent's advertised options.
 */
export function modelRoutingFieldsForInterface(
	level: InterfaceLevel,
	selections: ChatRoutingSelections
): ChatRoutingFields {
	if (level === "simple") {
		const fields: ChatRoutingFields = {};
		const mode = selections.simpleApprovalDefaults?.mode?.trim();
		if (mode) {
			fields.acp_mode = mode;
		}
		const config = selections.simpleApprovalDefaults?.config;
		if (config && Object.keys(config).length > 0) {
			fields.acp_config = config;
		}
		return fields;
	}

	const fields: ChatRoutingFields = {};
	const model = selections.model?.trim();
	const acpMode = selections.acpMode?.trim();
	const acpModel = selections.acpModel?.trim();

	if (model) {
		fields.model = model;
	}
	if (acpMode) {
		fields.acp_mode = acpMode;
	}
	if (acpModel) {
		fields.acp_model = acpModel;
	}
	if (selections.acpConfig && Object.keys(selections.acpConfig).length > 0) {
		fields.acp_config = selections.acpConfig;
	}

	return fields;
}
