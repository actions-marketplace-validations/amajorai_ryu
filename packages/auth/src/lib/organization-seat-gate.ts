/** Pure seat-admission rules shared by the Better Auth hooks and their tests. */

export interface SeatAdmissionDecision {
	readonly allowed: boolean;
	readonly reason?: string;
}

/**
 * A pending invitation does not spend a seat until it is claimed, but an
 * in-flight claim does. This function is intentionally pure so the database
 * and Polar lookups remain outside the policy itself.
 */
export const decideSeatAdmission = (input: {
	billedSeats: number;
	memberCount: number;
	reservedSeatCount: number;
}): SeatAdmissionDecision => {
	const seats = Math.max(0, Math.floor(input.billedSeats));
	const members = Math.max(0, Math.floor(input.memberCount));
	const reserved = Math.max(0, Math.floor(input.reservedSeatCount));
	if (members + reserved >= seats) {
		return {
			allowed: false,
			reason:
				"No unassigned Teams seat is available. Ask an organization owner or admin to add a seat first.",
		};
	}
	return { allowed: true };
};
