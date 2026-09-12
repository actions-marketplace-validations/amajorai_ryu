import {
	type AgentSelection,
	defaultCloudAgentSelection,
	isAgentSelectionEmpty,
} from "@/src/lib/api/preferences.ts";

export type BotManagedEntryState =
	| "checking-subscription"
	| "subscribe"
	| "provisioning"
	| "ready";

/**
 * Resolve the cloud selection for the managed Bot surface.
 *
 * Console owners/admins configure the managed node's cloud lane through the
 * existing Gateway defaults control. Bot must preserve that node-scoped value
 * and only seed the product default for a genuinely unset (or unreadable)
 * preference.
 */
export function resolveBotCloudSelection(current: AgentSelection): {
	selection: AgentSelection;
	shouldPersist: boolean;
} {
	if (!isAgentSelectionEmpty(current)) {
		return { selection: current, shouldPersist: false };
	}
	return {
		selection: defaultCloudAgentSelection(true),
		shouldPersist: true,
	};
}

export function resolveBotManagedEntryState(input: {
	hasManagedNode: boolean;
	managedInference: boolean;
	resolvingSubscription: boolean;
}): BotManagedEntryState {
	if (input.resolvingSubscription) {
		return "checking-subscription";
	}
	if (!input.managedInference) {
		return "subscribe";
	}
	return input.hasManagedNode ? "ready" : "provisioning";
}
