import { describe, expect, test } from "bun:test";

import {
	DEFAULT_AGENT_RULES_CONFIG,
	legacyRulesToConfig,
	parseAgentRulesConfig,
} from "./agent-rules.ts";

describe("agent rules config", () => {
	test("uses the requested defaults", () => {
		expect(DEFAULT_AGENT_RULES_CONFIG).toEqual({
			applyMode: "auto",
			autoInject: true,
			enabled: true,
			rules: [],
			turnsPerPlan: 0,
		});
	});

	test("migrates legacy prompt rules", () => {
		expect(legacyRulesToConfig([" Cite sources ", "", "Be concise"])).toEqual({
			...DEFAULT_AGENT_RULES_CONFIG,
			rules: [
				{ enabled: true, id: "legacy-0", mode: "auto", text: "Cite sources" },
				{ enabled: true, id: "legacy-2", mode: "auto", text: "Be concise" },
			],
		});
	});

	test("sanitizes stored config and accepts object rule content", () => {
		const config = parseAgentRulesConfig(
			JSON.stringify({
				applyMode: "always",
				autoInject: false,
				enabled: true,
				rules: [{ content: "Use bullets", enabled: false, mode: "manual" }],
				turnsPerPlan: -3,
			})
		);
		expect(config.applyMode).toBe("always");
		expect(config.autoInject).toBe(false);
		expect(config.rules[0]).toMatchObject({
			enabled: false,
			mode: "manual",
			text: "Use bullets",
		});
		expect(config.turnsPerPlan).toBe(0);
	});
});
