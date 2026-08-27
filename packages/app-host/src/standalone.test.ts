import { describe, expect, test } from "bun:test";
import {
	parseStandaloneAppBundle,
	standaloneCompanionId,
	standaloneDataDir,
	standalonePortOffset,
	standalonePortOffsetBounds,
} from "./standalone.ts";

describe("standalone app contract", () => {
	test("derives a stable isolated port namespace", () => {
		const first = standalonePortOffset("@ryu/expenses");

		expect(first).toBe(standalonePortOffset("@ryu/expenses"));
		expect(first).toBeGreaterThanOrEqual(standalonePortOffsetBounds.min);
		expect(first).toBeLessThanOrEqual(standalonePortOffsetBounds.max);
		expect(first).not.toBe(0);
	});

	test("keeps app data below one platform root without path traversal", () => {
		expect(standaloneDataDir("@ryu/expenses", "/data/Ryu/")).toBe(
			"/data/Ryu/ryu-apps/ryu-expenses"
		);
	});

	test("selects the app-owned Companion and rejects malformed carriage", () => {
		expect(
			standaloneCompanionId(
				[
					{ id: "app__other", pluginId: "@ryu/other" },
					{ id: "app__expenses", pluginId: "@ryu/expenses" },
				],
				"@ryu/expenses"
			)
		).toBe("app__expenses");
		expect(
			parseStandaloneAppBundle({
				schemaVersion: 1,
				appId: "@ryu/expenses",
				appName: "Expenses",
				version: "0.1.0",
				manifest: { id: "@ryu/expenses" },
				sidecars: [],
				uiCode: null,
			})?.appId
		).toBe("@ryu/expenses");
		expect(parseStandaloneAppBundle({ appId: "@ryu/expenses" })).toBeNull();
	});
});
