import { describe, expect, test } from "bun:test";
import {
	DETAIL_CONTENT_VPAD,
	DETAIL_MAX_H,
	DETAIL_SIZES,
	pillHeight,
	pillOverflows,
} from "./island-config.ts";

describe("pillHeight", () => {
	test("keeps the base height until the content needs more", () => {
		const base = DETAIL_SIZES.context.height;
		expect(pillHeight(base, 0)).toBe(base);
		expect(pillHeight(base, base - DETAIL_CONTENT_VPAD)).toBe(base);
	});

	test("grows past the base once the content outgrows a single row", () => {
		const base = DETAIL_SIZES.context.height;
		// Two wrapped rows of the pill's ~20px text.
		expect(pillHeight(base, 40)).toBe(40 + DETAIL_CONTENT_VPAD);
	});

	test("caps at the max so tall content scrolls instead of growing", () => {
		expect(pillHeight(DETAIL_SIZES.suggestion.height, 1000)).toBe(DETAIL_MAX_H);
	});

	test("holds the base while nothing is mounted (unmeasured)", () => {
		// A state swap unmounts the observed node and reports 0; the shape must not
		// collapse to the padding in the gap before the next surface measures.
		expect(pillHeight(DETAIL_SIZES.suggestion.height, 0)).toBe(
			DETAIL_SIZES.suggestion.height
		);
	});
});

describe("pillOverflows", () => {
	test("is false when unmeasured or when the content fits", () => {
		expect(pillOverflows(0)).toBe(false);
		expect(pillOverflows(DETAIL_MAX_H - DETAIL_CONTENT_VPAD)).toBe(false);
	});

	test("is true only past the cap", () => {
		expect(pillOverflows(DETAIL_MAX_H - DETAIL_CONTENT_VPAD + 1)).toBe(true);
	});
});
