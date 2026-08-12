// apps/desktop/src/lib/timezone.test.ts
//
// The display time zone only earns its keep if the formatters actually shift
// with it and day buckets move too — a 09:00 Tokyo stamp filed under the
// machine's midnight would read "Yesterday". These pin both.
//
// bun's test runtime has no localStorage, which is exactly the "persistence
// unavailable" path the module already guards; the preference still lives in
// the module-level cache, so every assertion below is about behaviour, not
// storage.

import { afterEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_TIMEZONE,
	effectiveTimeZone,
	formatDate,
	formatDateTime,
	formatTime,
	getTimezonePreference,
	resetTimezone,
	resolveTimeZone,
	setTimezonePreference,
	startOfTodayMs,
	timezoneLabel,
	timezoneOptions,
	zoneOffsetLabel,
} from "./timezone.ts";

// 2026-01-15T23:30Z — deliberately late enough in the UTC day that Tokyo
// (+09:00) is already on the 16th and Los Angeles (-08:00) is still on the 15th.
const NOW = new Date("2026-01-15T23:30:00.000Z").getTime();

afterEach(() => {
	resetTimezone();
});

describe("timezone preference", () => {
	it("defaults to the system sentinel and resolves to no explicit zone", () => {
		expect(getTimezonePreference()).toBe(DEFAULT_TIMEZONE);
		expect(resolveTimeZone()).toBeUndefined();
	});

	it("resolves an explicit zone once set", () => {
		setTimezonePreference("Asia/Tokyo");
		expect(getTimezonePreference()).toBe("Asia/Tokyo");
		expect(resolveTimeZone()).toBe("Asia/Tokyo");
		expect(effectiveTimeZone()).toBe("Asia/Tokyo");
	});

	it("reset returns to the system sentinel", () => {
		setTimezonePreference("Asia/Tokyo");
		resetTimezone();
		expect(getTimezonePreference()).toBe(DEFAULT_TIMEZONE);
	});
});

describe("formatters", () => {
	it("renders the same instant differently per zone", () => {
		setTimezonePreference("Asia/Tokyo");
		const tokyo = formatTime(NOW, {
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		setTimezonePreference("America/Los_Angeles");
		const la = formatTime(NOW, {
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});

		expect(tokyo).toBe("08:30");
		expect(la).toBe("15:30");
	});

	it("crosses the date line for the date part too", () => {
		setTimezonePreference("Asia/Tokyo");
		expect(
			formatDate(NOW, { year: "numeric", month: "2-digit", day: "2-digit" })
		).toContain("16");
		setTimezonePreference("America/Los_Angeles");
		expect(
			formatDate(NOW, { year: "numeric", month: "2-digit", day: "2-digit" })
		).toContain("15");
	});

	it("returns an empty string for an unparseable value instead of 'Invalid Date'", () => {
		expect(formatDateTime("not a date")).toBe("");
		expect(formatDate(Number.NaN)).toBe("");
	});

	it("falls back rather than throwing on an unsupported zone id", () => {
		setTimezonePreference("Mars/Olympus_Mons");
		expect(formatDateTime(NOW)).not.toBe("");
	});
});

describe("startOfTodayMs", () => {
	it("is midnight in the selected zone, not the machine's", () => {
		setTimezonePreference("Asia/Tokyo");
		// 2026-01-16T00:00 Tokyo == 2026-01-15T15:00Z
		expect(startOfTodayMs(NOW)).toBe(Date.parse("2026-01-15T15:00:00.000Z"));

		setTimezonePreference("America/Los_Angeles");
		// 2026-01-15T00:00 LA == 2026-01-15T08:00Z
		expect(startOfTodayMs(NOW)).toBe(Date.parse("2026-01-15T08:00:00.000Z"));
	});

	it("handles a zone on a half-hour offset", () => {
		setTimezonePreference("Asia/Kolkata");
		// 2026-01-16T00:00 +05:30 == 2026-01-15T18:30Z
		expect(startOfTodayMs(NOW)).toBe(Date.parse("2026-01-15T18:30:00.000Z"));
	});

	it("lands exactly on midnight when the instant already is midnight there", () => {
		setTimezonePreference("UTC");
		const midnight = Date.parse("2026-01-15T00:00:00.000Z");
		expect(startOfTodayMs(midnight)).toBe(midnight);
	});
});

describe("the option list", () => {
	it("pins System first and sorts the rest west to east", () => {
		const options = timezoneOptions();
		expect(options[0].value).toBe("system");
		expect(options[0].label).toStartWith("System (");

		const rest = options.slice(1);
		expect(rest.length).toBeGreaterThan(10);
		for (let i = 1; i < rest.length; i++) {
			expect(rest[i].offsetMinutes).toBeGreaterThanOrEqual(
				rest[i - 1].offsetMinutes
			);
		}
	});

	it("labels each zone with a padded offset and a readable name", () => {
		const london = timezoneOptions().find((o) => o.value === "Europe/London");
		expect(london?.label).toMatch(/^\(GMT[+-]\d{2}:\d{2}\) Europe\/London$/);

		const newYork = timezoneOptions().find(
			(o) => o.value === "America/New_York"
		);
		expect(newYork?.label).toContain("America/New York");
	});

	it("reads a zone's current offset", () => {
		expect(zoneOffsetLabel("UTC", new Date(NOW))).toBe("GMT+00:00");
		expect(zoneOffsetLabel("Asia/Tokyo", new Date(NOW))).toBe("GMT+09:00");
		expect(zoneOffsetLabel("Asia/Kolkata", new Date(NOW))).toBe("GMT+05:30");
		expect(zoneOffsetLabel("America/Los_Angeles", new Date(NOW))).toBe(
			"GMT-08:00"
		);
	});

	it("echoes an unknown stored value back as its own label", () => {
		expect(timezoneLabel("Mars/Olympus_Mons")).toBe("Mars/Olympus_Mons");
	});

	it("reuses the list within a day and rebuilds across one", () => {
		// The offsets baked into the labels go stale at a DST transition, which
		// always lands on a day boundary — so same day must reuse, next day must
		// not.
		const same = timezoneOptions(NOW);
		expect(timezoneOptions(NOW + 60_000)).toBe(same);
		expect(timezoneOptions(NOW + 2 * 86_400_000)).not.toBe(same);
	});
});
