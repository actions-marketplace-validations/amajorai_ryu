import { describe, expect, test } from "bun:test";
import { resolveBotManagedEntryState } from "./bot-managed-entry-state.ts";

describe("Ryu Bot managed entry", () => {
	test("waits for the subscription verdict before deciding", () => {
		expect(
			resolveBotManagedEntryState({
				hasManagedNode: false,
				managedInference: false,
				resolvingSubscription: true,
			})
		).toBe("checking-subscription");
	});

	test("requires a subscription", () => {
		expect(
			resolveBotManagedEntryState({
				hasManagedNode: true,
				managedInference: false,
				resolvingSubscription: false,
			})
		).toBe("subscribe");
	});

	test("waits for the managed workspace after payment", () => {
		expect(
			resolveBotManagedEntryState({
				hasManagedNode: false,
				managedInference: true,
				resolvingSubscription: false,
			})
		).toBe("provisioning");
	});

	test("enters the shared desktop shell once a managed node is available", () => {
		expect(
			resolveBotManagedEntryState({
				hasManagedNode: true,
				managedInference: true,
				resolvingSubscription: false,
			})
		).toBe("ready");
	});
});
