// Unit tests for the dither validator and the two contrast helpers beside it.
//
// `normalizeDither` is a safety boundary — `fillOf` THROWS on an unknown palette
// name, so a typo'd colour in one untrusted manifest would take down a whole
// catalog list with a render error. The tests below pin that it always degrades to
// null or a paintable spec, never to something that reaches `fillOf` unchecked.
//
// `ditherDissolves` / `opaqueDither` are the LEGIBILITY half. Every packaged
// manifest now declares the standard `{from: <hue>, to: "transparent", direction:
// "down"}` wash, which covers only its near end — so any surface with a hardcoded
// light foreground must either follow the theme (`AppIcon`) or force the ramp
// opaque (the detail hero). These tests exist because that regression is invisible
// in one theme: a white glyph on a dissolved wash reads perfectly on a dark card
// and disappears completely on a light one.

import { describe, expect, test } from "bun:test";
import { ditherDissolves, normalizeDither, opaqueDither } from "./dither.ts";

describe("normalizeDither", () => {
	test("passes a fully specified numeric spec through", () => {
		expect(
			normalizeDither({ from: 138, to: "transparent", direction: "down" })
		).toEqual({ from: 138, to: "transparent", direction: "down" });
	});

	test("drops the whole spec when `from` cannot resolve", () => {
		expect(normalizeDither({ from: "chartreuse-ish" })).toBeNull();
		expect(normalizeDither({ from: Number.NaN })).toBeNull();
		expect(normalizeDither(null)).toBeNull();
	});

	test("omits an unresolvable `to` rather than dropping the spec", () => {
		const safe = normalizeDither({ from: 12, to: "not-a-colour" });
		expect(safe).toEqual({ from: 12 });
	});

	test("drops an unknown direction so the component default applies", () => {
		expect(normalizeDither({ from: 12, direction: "sideways" })).toEqual({
			from: 12,
		});
	});
});

describe("ditherDissolves", () => {
	test("true for the standard packaged wash", () => {
		expect(
			ditherDissolves({ from: 250, to: "transparent", direction: "down" })
		).toBe(true);
	});

	test("true when `to` is absent — DitherGradient defaults it to transparent", () => {
		expect(ditherDissolves({ from: 250 })).toBe(true);
	});

	test("false for a two-tone ramp, which covers its whole box", () => {
		expect(ditherDissolves({ from: 250, to: 284 })).toBe(false);
	});
});

describe("opaqueDither", () => {
	test("turns the standard wash into a two-tone ramp in its own hue", () => {
		const opaque = opaqueDither({
			from: 250,
			to: "transparent",
			direction: "down",
		});
		expect(opaque).toEqual({ from: 250, to: 284, direction: "down" });
		expect(ditherDissolves(opaque)).toBe(false);
	});

	test("wraps the offset hue around the colour wheel", () => {
		expect(opaqueDither({ from: 348, to: "transparent" })?.to).toBe(22);
	});

	test("leaves an already-opaque spec exactly as it was", () => {
		const two = { from: 250, to: 284, direction: "up" as const };
		expect(opaqueDither(two)).toEqual(two);
	});

	test("passes null through, so callers keep their own fallback path", () => {
		expect(opaqueDither(null)).toBeNull();
	});

	test("cannot offset a named palette colour, so it returns it untouched", () => {
		// No arithmetic on a name — the caller keeps whatever contrast it had.
		const named = normalizeDither({ from: "purple", to: "transparent" });
		expect(named).not.toBeNull();
		expect(opaqueDither(named)).toEqual(named);
	});
});
