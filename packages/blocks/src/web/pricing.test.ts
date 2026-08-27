import { describe, expect, it } from "bun:test";
import {
	businessIncludedCreditUsd,
	businessMonthlyPriceUsd,
} from "./business-pricing.ts";

describe("Business public pricing helpers", () => {
	it("quotes the $300 floor and $50 marginal seats", () => {
		expect(businessMonthlyPriceUsd(5)).toBe(300);
		expect(businessMonthlyPriceUsd(6)).toBe(350);
		expect(businessMonthlyPriceUsd(25)).toBe(1300);
	});

	it("doubles the pooled Teams credit bundle", () => {
		expect(businessIncludedCreditUsd(5)).toBe(100);
		expect(businessIncludedCreditUsd(10)).toBe(200);
	});
});
