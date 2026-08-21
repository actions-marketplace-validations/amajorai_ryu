import { describe, expect, it } from "bun:test";
import { hostedAgentContributionMargin } from "./agent-plan-economics.ts";

describe("hosted agent contribution model", () => {
	it("uses the new Pro price and growing shared pool", () => {
		const five = hostedAgentContributionMargin("pro", 5);
		const ten = hostedAgentContributionMargin("pro", 10);
		const twenty = hostedAgentContributionMargin("pro", 20);

		expect(five.monthlyPriceUsd).toBe(250);
		expect(five.includedPoolUsd).toBe(50);
		expect(five.contributionUsd).toBeCloseTo(173.6, 6);
		expect(ten.monthlyPriceUsd).toBe(500);
		expect(ten.includedPoolUsd).toBe(175);
		expect(twenty.monthlyPriceUsd).toBe(900);
		expect(twenty.includedPoolUsd).toBe(425);
	});

	it("keeps Max profitable through the volume bands", () => {
		const fifty = hostedAgentContributionMargin("max", 50);
		const sixty = hostedAgentContributionMargin("max", 60);
		const oneTen = hostedAgentContributionMargin("max", 110);

		expect(fifty.monthlyPriceUsd).toBe(2500);
		expect(fifty.includedPoolUsd).toBe(250);
		expect(fifty.margin).toBeCloseTo(0.817_34, 5);
		expect(sixty.monthlyPriceUsd).toBe(2800);
		expect(sixty.includedPoolUsd).toBe(300);
		expect(oneTen.monthlyPriceUsd).toBe(4250);
		expect(oneTen.includedPoolUsd).toBe(550);
	});

	it("uses the Singapore node reserve without changing the contract price", () => {
		const eu = hostedAgentContributionMargin("pro", 1, "eu");
		const singapore = hostedAgentContributionMargin("pro", 1, "sin");

		expect(singapore.nodeReserveUsd).toBe(44);
		expect(singapore.monthlyPriceUsd).toBe(eu.monthlyPriceUsd);
		expect(singapore.contributionUsd).toBeCloseTo(141.6, 6);
	});
});
