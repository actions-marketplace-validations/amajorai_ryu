export type BotManagedEntryState =
	| "checking-subscription"
	| "subscribe"
	| "provisioning"
	| "ready";

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
