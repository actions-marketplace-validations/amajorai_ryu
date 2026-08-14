import { describe, expect, it } from "bun:test";
import {
	bucketByDate,
	CONTRIBUTED_DATE_KEYS,
	DATE_BUCKET_LABELS,
	DAY_MS,
	dateBucketKey,
	rowStamp,
	stampEpoch,
	UNDATED_BUCKET_KEY,
} from "@/src/lib/sidebar/date-buckets.ts";

// A fixed "midnight in the display zone" so every case is deterministic — the
// production caller passes `startOfTodayMs()`, which is exactly why this argument
// is threaded through rather than read inside.
const START = 1_700_000_000_000;

describe("dateBucketKey", () => {
	it("puts midnight itself in today, not yesterday", () => {
		expect(dateBucketKey(START, START)).toBe("today");
	});

	it("walks the thresholds outward", () => {
		expect(dateBucketKey(START + 5 * 3_600_000, START)).toBe("today");
		expect(dateBucketKey(START - 1, START)).toBe("yesterday");
		expect(dateBucketKey(START - DAY_MS, START)).toBe("yesterday");
		expect(dateBucketKey(START - DAY_MS - 1, START)).toBe("last-week");
		expect(dateBucketKey(START - 7 * DAY_MS, START)).toBe("last-week");
		expect(dateBucketKey(START - 7 * DAY_MS - 1, START)).toBe("last-month");
		expect(dateBucketKey(START - 30 * DAY_MS, START)).toBe("last-month");
		expect(dateBucketKey(START - 30 * DAY_MS - 1, START)).toBe("last-year");
		expect(dateBucketKey(START - 365 * DAY_MS, START)).toBe("last-year");
		expect(dateBucketKey(START - 365 * DAY_MS - 1, START)).toBe("older");
	});
});

describe("stampEpoch", () => {
	it("reads epoch ms and ISO strings alike", () => {
		expect(stampEpoch(START)).toBe(START);
		expect(stampEpoch("2023-11-14T22:13:20.000Z")).toBe(START);
	});

	it("reports absent rather than 1970", () => {
		// The whole reason this exists next to `toEpoch`: `toEpoch` coerces all
		// three of these to 0, which `dateBucketKey` would file under "Older".
		expect(stampEpoch(null)).toBeNull();
		expect(stampEpoch(undefined)).toBeNull();
		expect(stampEpoch("")).toBeNull();
		expect(stampEpoch("not a date")).toBeNull();
		expect(stampEpoch(0)).toBeNull();
	});
});

describe("bucketByDate", () => {
	const item = (id: string, updatedAt: number | null) => ({ id, updatedAt });
	const stampOf = (i: { updatedAt: number | null }) => i.updatedAt;

	it("returns only non-empty buckets, chronologically", () => {
		const buckets = bucketByDate(
			[
				item("older", START - 400 * DAY_MS),
				item("today", START + 1),
				item("last-week", START - 3 * DAY_MS),
			],
			stampOf,
			START
		);
		expect(buckets.map((b) => b.key)).toEqual(["today", "last-week", "older"]);
		expect(buckets.map((b) => b.label)).toEqual([
			"Today",
			"Last week",
			"Older",
		]);
	});

	it("sorts each bucket most-recent-first", () => {
		const buckets = bucketByDate(
			[
				item("morning", START + 1000),
				item("evening", START + 9000),
				item("noon", START + 5000),
			],
			stampOf,
			START
		);
		expect(buckets).toHaveLength(1);
		expect(buckets[0]?.items.map((i) => i.id)).toEqual([
			"evening",
			"noon",
			"morning",
		]);
	});

	it("collects undated rows into a trailing bucket instead of Older", () => {
		const buckets = bucketByDate(
			[item("a", null), item("b", START + 1), item("c", null)],
			stampOf,
			START
		);
		expect(buckets.map((b) => b.key)).toEqual(["today", UNDATED_BUCKET_KEY]);
		// Incoming order preserved — there is no stamp to sort by.
		expect(buckets[1]?.items.map((i) => i.id)).toEqual(["a", "c"]);
		expect(buckets[1]?.label).toBe("Undated");
	});

	it("omits the undated bucket when every row is dated", () => {
		const buckets = bucketByDate([item("a", START + 1)], stampOf, START);
		expect(buckets.some((b) => b.key === UNDATED_BUCKET_KEY)).toBe(false);
	});

	it("returns nothing for an empty list", () => {
		expect(bucketByDate([], stampOf, START)).toEqual([]);
	});

	it("labels every key it can emit", () => {
		const buckets = bucketByDate(
			[
				item("t", START),
				item("y", START - DAY_MS),
				item("w", START - 3 * DAY_MS),
				item("m", START - 10 * DAY_MS),
				item("yr", START - 100 * DAY_MS),
				item("o", START - 400 * DAY_MS),
				item("u", null),
			],
			stampOf,
			START
		);
		expect(buckets).toHaveLength(7);
		for (const bucket of buckets) {
			expect(DATE_BUCKET_LABELS[bucket.key]).toBe(bucket.label);
		}
	});
});

describe("rowStamp", () => {
	it("prefers the spec's declared key", () => {
		expect(rowStamp({ startedAt: START, updatedAt: 1 }, "startedAt")).toBe(
			START
		);
	});

	it("reports absent when the declared key carries nothing, without falling back", () => {
		// An app that named a field is taken at its word: silently reading a
		// different one would group by something the manifest did not choose.
		expect(
			rowStamp({ startedAt: null, updatedAt: START }, "startedAt")
		).toBeNull();
	});

	it("probes the common keys when no key is declared", () => {
		expect(rowStamp({ updatedAt: START })).toBe(START);
		expect(rowStamp({ created_at: "2023-11-14T22:13:20.000Z" })).toBe(START);
		expect(rowStamp({ timestamp: START })).toBe(START);
	});

	it("probes in order, so updatedAt wins over createdAt", () => {
		expect(rowStamp({ createdAt: 1, updatedAt: START })).toBe(START);
	});

	it("returns null for a row that carries no date at all", () => {
		expect(rowStamp({ id: "x", title: "no dates here" })).toBeNull();
	});

	it("ignores non-scalar values under a probed key", () => {
		expect(rowStamp({ updatedAt: { nested: START } })).toBeNull();
	});

	it("probes updated before created", () => {
		expect(CONTRIBUTED_DATE_KEYS.indexOf("updatedAt")).toBeLessThan(
			CONTRIBUTED_DATE_KEYS.indexOf("createdAt")
		);
	});
});
