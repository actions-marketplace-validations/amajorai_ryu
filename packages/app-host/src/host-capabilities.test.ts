import { describe, expect, it } from "bun:test";

import {
	detectBrowserHostCapabilities,
	dispatchRpc,
	type HostCapabilityDescriptor,
	type HostServices,
	METHOD_CAPABILITY,
} from "./rpc.ts";

const descriptor: HostCapabilityDescriptor = {
	androidOngoingNotifications: false,
	browserNotifications: false,
	dynamicIsland: false,
	hardwareBleRelay: false,
	haptics: true,
	localNotifications: false,
	liveActivities: false,
	platform: "ios",
	pushRegistration: false,
	quickActions: true,
	sounds: true,
};

const services: HostServices = {
	listAgents: async () => [],
	registerRoute: async (claim) => ({ path: claim.path }),
};

describe("read-only host capability descriptor", () => {
	it("is an explicit local contract method and derives without a grant", async () => {
		expect(METHOD_CAPABILITY["host.capabilities"]).toBe("host.capabilities");
		await expect(
			dispatchRpc("host.capabilities", [], new Set(), {
				...services,
				hostCapabilities: () => descriptor,
			})
		).resolves.toEqual(descriptor);
	});

	it("rejects arguments and unknown methods", async () => {
		await expect(
			dispatchRpc("host.capabilities", [{}], new Set(), services)
		).rejects.toThrow("takes no arguments");
		await expect(
			dispatchRpc("host.capabilities.raw", [], new Set(), services)
		).rejects.toThrow("Unknown method");
	});

	it("reports browser support as booleans and metadata only", () => {
		const result = detectBrowserHostCapabilities();
		expect(Object.keys(result).sort()).toEqual(
			[
				"androidOngoingNotifications",
				"browserNotifications",
				"dynamicIsland",
				"hardwareBleRelay",
				"haptics",
				"localNotifications",
				"liveActivities",
				"platform",
				"pushRegistration",
				"quickActions",
				"sounds",
			].sort()
		);
		for (const [key, value] of Object.entries(result)) {
			if (key !== "platform") {
				expect(typeof value).toBe("boolean");
			}
		}
	});
});
