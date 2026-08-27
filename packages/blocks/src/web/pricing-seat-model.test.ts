import { expect, test } from "bun:test";
import {
	HOSTED_AGENT_SLIDER_MAX,
	normalizeTeamsSeatCount,
	TEAMS_MAX_SEATS,
	TEAMS_MIN_SEATS,
} from "./pricing-seat-model.ts";

test("Teams seat selection stops at the Enterprise handoff", () => {
	expect(TEAMS_MAX_SEATS).toBe(50);
	expect(HOSTED_AGENT_SLIDER_MAX).toBe(51);
	expect(normalizeTeamsSeatCount(1000)).toBe(51);
	expect(normalizeTeamsSeatCount(3)).toBe(TEAMS_MIN_SEATS);
});
