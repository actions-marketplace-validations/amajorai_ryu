import { describe, expect, it } from "bun:test";
import {
	BUSINESS_SEAT_PRICE_TIERS,
	seatPriceMicroUsdForSeats,
} from "./plan-seat-pricing.ts";

describe("graduated organization seat pricing", () => {
	it("prices Business at a $300 five-seat floor and $50 marginal seats", () => {
		expect(seatPriceMicroUsdForSeats(BUSINESS_SEAT_PRICE_TIERS, 5)).toBe(
			300_000_000
		);
		expect(seatPriceMicroUsdForSeats(BUSINESS_SEAT_PRICE_TIERS, 6)).toBe(
			350_000_000
		);
		expect(seatPriceMicroUsdForSeats(BUSINESS_SEAT_PRICE_TIERS, 25)).toBe(
			1_300_000_000
		);
	});
});
