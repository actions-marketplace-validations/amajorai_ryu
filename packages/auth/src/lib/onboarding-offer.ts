/** Customer-facing Teams activation offer used by desktop onboarding. */
export const ONBOARDING_TEAMS_OFFER = {
	discountBasisPoints: 8000,
	durationMonths: 1,
	includedSeats: 5,
	listMonthlyPriceUsd: 250,
	trialMonthlyPriceUsd: 50,
} as const;

/** Polar discount is valid only on the monthly five-seat Teams product. */
export function onboardingOfferAppliesTo(slug: string): boolean {
	return slug.trim() === "teams-monthly";
}
