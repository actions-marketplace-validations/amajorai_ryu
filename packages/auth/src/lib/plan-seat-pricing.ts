/** One graduated seat-price band, inclusive at both ends. */
export interface PlanSeatPriceTier {
	readonly fromSeats: number;
	readonly pricePerSeatMicroUsd: number;
	readonly toSeats: number;
}

/** Business charges $60 across seats one through five, then $50 per seat. */
export const BUSINESS_SEAT_PRICE_TIERS = [
	{ fromSeats: 1, pricePerSeatMicroUsd: 60_000_000, toSeats: 5 },
	{ fromSeats: 6, pricePerSeatMicroUsd: 50_000_000, toSeats: 50 },
] as const satisfies readonly PlanSeatPriceTier[];

/**
 * Calculate the total monthly amount for a graduated seat price.
 *
 * A quantity below the first tier is clamped to that tier; a quantity above the
 * final tier is rejected instead of silently inventing a price. Plan-specific
 * minimums are enforced by the billing catalog and API validator.
 */
export const seatPriceMicroUsdForSeats = (
	tiers: readonly PlanSeatPriceTier[],
	seats: number
): number => {
	const firstTier = tiers[0];
	if (!firstTier) {
		throw new Error("A graduated seat price requires at least one tier");
	}
	const requestedSeats = Number.isFinite(seats) ? Math.floor(seats) : 0;
	const normalizedSeats = Math.max(firstTier.fromSeats, requestedSeats);
	let total = 0;

	for (const tier of tiers) {
		const from = Math.max(firstTier.fromSeats, tier.fromSeats);
		const to = Math.min(normalizedSeats, tier.toSeats);
		if (to < from) {
			continue;
		}
		total += (to - from + 1) * tier.pricePerSeatMicroUsd;
	}

	const finalTier = tiers.at(-1);
	if (!finalTier) {
		throw new Error("A graduated seat price requires a final tier");
	}
	if (normalizedSeats > finalTier.toSeats) {
		throw new Error(
			`No graduated seat price covers ${normalizedSeats} seats; maximum is ${finalTier.toSeats}`
		);
	}
	return total;
};
