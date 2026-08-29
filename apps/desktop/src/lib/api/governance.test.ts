import { describe, expect, it } from "bun:test";
import {
	fetchGatewayGovernance,
	type GovernanceLayer,
	parseGatewayGovernanceSnapshot,
	resolveGovernanceField,
	updateGatewayGovernance,
} from "./governance.ts";

describe("resolveGovernanceField", () => {
	it("keeps explicit false at the most-specific layer", () => {
		const layers: GovernanceLayer<boolean>[] = [
			{ scope: "node", value: true },
			{ scope: "organization", value: true },
			{ scope: "team", value: undefined },
			{ scope: "user", value: false },
		];

		expect(resolveGovernanceField(layers)).toEqual({
			scope: "user",
			value: false,
		});
	});

	it("inherits the nearest declared broader value", () => {
		const layers: GovernanceLayer<string>[] = [
			{ scope: "node", value: "node/" },
			{ scope: "organization", value: "org/" },
			{ scope: "team", value: undefined },
			{ scope: "user", value: undefined },
		];

		expect(resolveGovernanceField(layers)).toEqual({
			scope: "organization",
			value: "org/",
		});
	});
});

describe("parseGatewayGovernanceSnapshot", () => {
	it("preserves false values and marks unavailable managed layers", () => {
		const parsed = parseGatewayGovernanceSnapshot({
			schemaVersion: 1,
			layers: [
				{
					revision: 4,
					scope: "node",
					values: {
						git: { createDraftPullRequests: true },
						worktrees: { autoDelete: false },
					},
					writable: true,
				},
				{
					revision: 0,
					scope: "organization",
					unavailableReason: "This node is not managed.",
					values: {},
					writable: false,
				},
			],
		});

		expect(parsed.layers[0]?.values.worktrees?.autoDelete).toBe(false);
		expect(parsed.layers[1]?.unavailableReason).toBe(
			"This node is not managed."
		);
	});

	it("rejects a scope outside the closed hierarchy", () => {
		expect(() =>
			parseGatewayGovernanceSnapshot({
				schemaVersion: 1,
				layers: [
					{
						revision: 1,
						scope: "project",
						values: {},
						writable: true,
					},
				],
			})
		).toThrow("invalid governance scope");
	});
});

describe("governance transport", () => {
	it("fetches the active node snapshot and validates the response", async () => {
		const originalFetch = globalThis.fetch;
		const fakeFetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) =>
				new Response(
					JSON.stringify({
						schemaVersion: 1,
						layers: [
							{
								revision: 1,
								scope: "node",
								values: {},
								writable: true,
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 }
				),
			{ preconnect: originalFetch.preconnect }
		);
		globalThis.fetch = fakeFetch;

		try {
			const snapshot = await fetchGatewayGovernance({
				token: "node-token",
				url: "http://127.0.0.1:7980",
				userJwt: null,
			});
			expect(snapshot.layers[0]?.scope).toBe("node");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("writes only the selected local scope and settings kind", async () => {
		const originalFetch = globalThis.fetch;
		let requestBody = "";
		let requestUrl = "";
		const fakeFetch = Object.assign(
			async (...args: Parameters<typeof fetch>) => {
				requestUrl = String(args[0]);
				const init = args[1];
				requestBody = typeof init?.body === "string" ? init.body : "";
				return new Response(JSON.stringify({ schemaVersion: 1, layers: [] }), {
					headers: { "content-type": "application/json" },
					status: 200,
				});
			},
			{ preconnect: originalFetch.preconnect }
		);
		globalThis.fetch = fakeFetch;

		try {
			await updateGatewayGovernance(
				{ token: null, url: "http://127.0.0.1:7980", userJwt: null },
				"git",
				"user",
				{ branchPrefix: "codex/" }
			);
			expect(requestUrl).toEndWith("/api/gateway/governance/git");
			expect(JSON.parse(requestBody)).toEqual({
				scope: "user",
				values: { branchPrefix: "codex/" },
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
