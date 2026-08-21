import { describe, expect, it } from "bun:test";
import {
	budgetFormToRule,
	budgetRuleToForm,
	budgetUsdToMicroUsd,
	formatBudgetUsd,
	microUsdToBudgetInput,
} from "./budget-copy.ts";

describe("charged budget currency helpers", () => {
	it("converts USD input to integer micro-USD", () => {
		expect(budgetUsdToMicroUsd("1.25")).toBe(1_250_000);
		expect(budgetUsdToMicroUsd("0.000001")).toBe(1);
		expect(budgetUsdToMicroUsd(" 2 ")).toBe(2_000_000);
	});

	it("rejects malformed or over-precise USD input", () => {
		for (const value of ["", "-1", "1.0000001", "1e2", "$1"]) {
			expect(budgetUsdToMicroUsd(value)).toBeNull();
		}
	});

	it("round-trips stored limits into the desktop form", () => {
		expect(microUsdToBudgetInput(1_250_001)).toBe("1.250001");
		expect(
			budgetRuleToForm("agent-a", {
				limit: 1_250_001,
				action: "stop",
				alert: "warn",
			}).limitUsd
		).toBe("1.250001");
	});

	it("sends the dollar form value as micro-USD", () => {
		expect(
			budgetFormToRule({
				action: "stop",
				agentId: "agent-a",
				alert: "silent",
				include: { model: true, media: true, tools: true },
				downgrade_to: "",
				limitUsd: "1.00",
				restrict_max_tokens: "256",
			}).limit
		).toBe(1_000_000);
	});

	it("formats live spend in dollars", () => {
		expect(formatBudgetUsd(1_000_000)).toBe("$1.00");
		expect(formatBudgetUsd(125_000)).toBe("$0.13");
		expect(formatBudgetUsd(5000)).toBe("<$0.01");
	});
});
