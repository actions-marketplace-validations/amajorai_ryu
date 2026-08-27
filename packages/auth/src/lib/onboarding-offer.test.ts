import { describe, expect, test } from "bun:test";
import {
	ONBOARDING_TEAMS_OFFER,
	onboardingOfferAppliesTo,
} from "./onboarding-offer.ts";

describe("desktop onboarding Teams offer", () => {
	test("discounts one month from the five-seat Teams floor", () => {
		expect(ONBOARDING_TEAMS_OFFER).toMatchObject({
			durationMonths: 1,
			includedSeats: 5,
			listMonthlyPriceUsd: 250,
			trialMonthlyPriceUsd: 50,
		});
	});

	test("never applies to yearly checkout", () => {
		expect(onboardingOfferAppliesTo("teams-monthly")).toBe(true);
		expect(onboardingOfferAppliesTo("teams-yearly")).toBe(false);
	});
});
