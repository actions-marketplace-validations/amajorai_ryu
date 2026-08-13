// apps/desktop/src/components/layout/SeasonalEffects.test.ts
//
// The seasonal calendar is a list of overlapping date windows resolved by
// "first match wins", so the ORDER of SEASONS is load-bearing: New Year's Eve
// sits inside Christmas's whole-of-December window, and Valentine's sits inside
// Chinese New Year's. Reorder the table and the wrong holiday shows up on the
// one day of the year anybody is looking — a bug nobody would catch until it
// was too late to matter. These tests pin the resolution, not the dates.

import { describe, expect, test } from "bun:test";
import {
	getCurrentSeason,
	getSeasonById,
	getSeasonDisplayEmoji,
	SEASONS,
} from "./SeasonalEffects.tsx";

/** Local noon, so a timezone shift cannot roll the date over. */
function on(month: number, day: number): Date {
	return new Date(2026, month, day, 12, 0, 0);
}

describe("seasonal calendar", () => {
	test("a plain December day is Christmas", () => {
		expect(getCurrentSeason(on(11, 15))?.id).toBe("christmas");
	});

	test("New Year's Eve beats Christmas, which also covers December", () => {
		expect(getCurrentSeason(on(11, 31))?.id).toBe("new_year");
	});

	test("New Year's runs through January 2, then stops", () => {
		expect(getCurrentSeason(on(0, 2))?.id).toBe("new_year");
		expect(getCurrentSeason(on(0, 3))).toBeNull();
	});

	test("Chinese New Year beats Valentine's in their shared February window", () => {
		expect(getCurrentSeason(on(1, 10))?.id).toBe("cny");
	});

	test("most of the year has no season", () => {
		expect(getCurrentSeason(on(5, 15))).toBeNull();
		expect(getCurrentSeason(on(7, 1))).toBeNull();
	});

	test("every season is reachable by id", () => {
		for (const season of SEASONS) {
			expect(getSeasonById(season.id)).toBe(season);
		}
	});

	test("every season has a display emoji, including the glyph-based one", () => {
		for (const season of SEASONS) {
			expect(getSeasonDisplayEmoji(season).length).toBeGreaterThan(0);
		}
		// Christmas falls as a colored "*", so it must override the menu glyph.
		const christmas = getSeasonById("christmas");
		expect(christmas && getSeasonDisplayEmoji(christmas)).toBe("❄️");
	});
});
