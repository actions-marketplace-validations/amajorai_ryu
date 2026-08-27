export const TEAMS_MIN_SEATS = 5;
export const TEAMS_MAX_SEATS = 50;
/** The final slider value is the Enterprise handoff state: 51+. */
export const HOSTED_AGENT_SLIDER_MAX = TEAMS_MAX_SEATS + 1;

export function normalizeTeamsSeatCount(seats: number): number {
	return Number.isFinite(seats)
		? Math.min(
				HOSTED_AGENT_SLIDER_MAX,
				Math.max(TEAMS_MIN_SEATS, Math.floor(seats))
			)
		: TEAMS_MIN_SEATS;
}
