import { describe, expect, test } from "bun:test";
import {
	formatCount,
	formatCurrency,
	formatMicroUsd,
	formatMinorCurrency,
	formatNumber,
} from "./number-format.ts";

describe("formatCount", () => {
	test("keeps thousands readable with separators", () => {
		expect(formatCount(1234)).toBe("1,234");
		expect(formatCount(999_999)).toBe("999,999");
	});

	test("uses a lowercase m for million-scale counts", () => {
		expect(formatCount(1_234_567)).toBe("1.2m");
		expect(formatCount(2_000_000)).toBe("2m");
	});

	test("handles missing and non-finite values", () => {
		expect(formatCount(null)).toBeNull();
		expect(formatCount(Number.NaN)).toBeNull();
		expect(formatNumber(null)).toBe("—");
	});
});

describe("currency formatting", () => {
	test("keeps normal currency amounts precise and separated", () => {
		expect(formatCurrency(1234.5)).toBe("$1,234.50");
		expect(formatMinorCurrency(123_456)).toBe("$1,234.56");
	});

	test("uses lowercase m for large currency amounts", () => {
		expect(formatCurrency(1_234_567)).toBe("$1.2m");
		expect(formatMicroUsd(1_234_567_000_000)).toBe("$1.2m");
	});

	test("keeps minor-unit prices precise until the million-dollar boundary", () => {
		expect(formatMinorCurrency(100_000_000)).toBe("$1m");
	});
});
