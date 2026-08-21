import { describe, expect, test } from "bun:test";
import { normalizeRecommendations } from "./recommendations.ts";

describe("normalizeRecommendations", () => {
	test("keeps safe cross-kind card fields and drops unknown rows", () => {
		const result = normalizeRecommendations({
			cadence: "monthly",
			items: [
				{
					id: "owner/tool",
					kind: "mcp",
					name: "Tool",
					reason: "Complements your setup",
					credential: "must-not-render",
				},
				{ id: "unknown", kind: "memory", name: "Private context" },
			],
		});

		expect(result.cadence).toBe("monthly");
		expect(result.items).toEqual([
			{
				description: null,
				iconUrl: null,
				id: "owner/tool",
				installed: false,
				kind: "mcp",
				name: "Tool",
				reason: "Complements your setup",
			},
		]);
		expect(JSON.stringify(result)).not.toContain("credential");
	});

	test("uses the safe defaults and closes cadence values", () => {
		expect(normalizeRecommendations({ cadence: "hourly" })).toEqual({
			cadence: "weekly",
			enabled: true,
			hidden: false,
			items: [],
		});
		expect(
			normalizeRecommendations({ enabled: false, hidden: true }).enabled
		).toBe(false);
	});
});
