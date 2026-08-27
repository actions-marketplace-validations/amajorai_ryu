import { describe, expect, it } from "bun:test";
import {
	creditBalanceStatus,
	LOW_CREDIT_REMAINING_PERCENT,
} from "./credit-warning.ts";

const MONTHLY_POOL = 10_000_000;

describe("creditBalanceStatus", () => {
	it("marks an exhausted organization wallet as empty", () => {
		expect(
			creditBalanceStatus({
				balanceMicroUsd: 0,
				monthlyCreditPoolMicroUsd: MONTHLY_POOL,
			})
		).toEqual({ kind: "empty", remainingPercent: 0 });
	});

	it("warns at the low-credit threshold", () => {
		expect(
			creditBalanceStatus({
				balanceMicroUsd:
					(MONTHLY_POOL * LOW_CREDIT_REMAINING_PERCENT) / 100,
				monthlyCreditPoolMicroUsd: MONTHLY_POOL,
			})
		).toEqual({ kind: "low", remainingPercent: LOW_CREDIT_REMAINING_PERCENT });
	});

	it("keeps a balance above the threshold healthy", () => {
		expect(
			creditBalanceStatus({
				balanceMicroUsd: 2_100_000,
				monthlyCreditPoolMicroUsd: MONTHLY_POOL,
			})
		).toEqual({ kind: "healthy", remainingPercent: 21 });
	});

	it("caps top-up balances at the included-pool denominator", () => {
		expect(
			creditBalanceStatus({
				balanceMicroUsd: 25_000_000,
				monthlyCreditPoolMicroUsd: MONTHLY_POOL,
			})
		).toEqual({ kind: "healthy", remainingPercent: 100 });
	});

	it("does not invent a subscription percentage for a PAYG-only wallet", () => {
		expect(
			creditBalanceStatus({
				balanceMicroUsd: 2_000_000,
				monthlyCreditPoolMicroUsd: 0,
			})
		).toEqual({ kind: "healthy", remainingPercent: null });
	});
});

