import { describe, expect, it } from "bun:test";
import {
	businessIncludedCreditUsd,
	businessMonthlyPriceUsd,
} from "./business-pricing.ts";
import {
	annualTotalPrice,
	effectiveMonthlyPrice,
	hostedAgentIncludedCreditUsd,
	hostedAgentMonthlyPriceUsd,
} from "./pricing.tsx";

describe("Business public pricing helpers", () => {
	it("quotes the $300 floor and $50 marginal seats", () => {
		expect(businessMonthlyPriceUsd(5)).toBe(300);
		expect(businessMonthlyPriceUsd(6)).toBe(350);
		expect(businessMonthlyPriceUsd(25)).toBe(1300);
	});

	it("uses completed five-seat bundles for the Business pool", () => {
		expect(businessIncludedCreditUsd(5)).toBe(100);
		expect(businessIncludedCreditUsd(6)).toBe(100);
		expect(businessIncludedCreditUsd(10)).toBe(200);
		expect(businessIncludedCreditUsd(15)).toBe(300);
		expect(businessIncludedCreditUsd(25)).toBe(500);
	});

	it("keeps the yearly per-seat equivalent mathematically exact", () => {
		expect(effectiveMonthlyPrice(50, true)).toBeCloseTo(41.6667, 4);
		expect(annualTotalPrice(50) * 5).toBe(2500);
	});
});

describe("Teams Lite private pricing helpers", () => {
	it("keeps the floor exactly $100 below Teams and lowers the pool", () => {
		expect(hostedAgentMonthlyPriceUsd("teams-lite", 5)).toBe(150);
		expect(hostedAgentMonthlyPriceUsd("teams-lite", 6)).toBe(200);
		expect(hostedAgentMonthlyPriceUsd("teams-lite", 10)).toBe(400);
		expect(hostedAgentMonthlyPriceUsd("teams", 10)).toBe(500);
		expect(hostedAgentIncludedCreditUsd("teams-lite", 5)).toBe(20);
		expect(hostedAgentIncludedCreditUsd("teams-lite", 10)).toBe(40);
		expect(hostedAgentIncludedCreditUsd("teams", 10)).toBe(100);
	});
});
