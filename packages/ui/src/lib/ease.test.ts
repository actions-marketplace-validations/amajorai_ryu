// Guards the damping ratios of the shared spring tokens.
//
// These drifted once already: SPRING_PANEL shipped at ζ ~= 1.38 and SPRING_GLIDE
// at ~= 1.34 while their comments claimed critical damping, so modals and slider
// fills crept into place instead of landing. Nothing about `stiffness: 420,
// damping: 40` reveals that by eye — hence this file.

import { describe, expect, test } from "bun:test";
import {
	EASE_DRAWER,
	EASE_IN_OUT,
	EASE_OUT,
	SPRING_GLIDE,
	SPRING_LAYOUT,
	SPRING_MOUSE,
	SPRING_PANEL,
	SPRING_PRESS,
	SPRING_SWAP,
} from "./ease.ts";

/** ζ = c / (2 * sqrt(k * m)) */
const dampingRatio = (s: {
	stiffness: number;
	damping: number;
	mass: number;
}): number => s.damping / (2 * Math.sqrt(s.stiffness * s.mass));

describe("spring damping ratios", () => {
	test("no token is overdamped — nothing may creep into its target", () => {
		const tokens = {
			SPRING_PRESS,
			SPRING_SWAP,
			SPRING_PANEL,
			SPRING_LAYOUT,
			SPRING_MOUSE,
			SPRING_GLIDE,
		};
		for (const [name, token] of Object.entries(tokens)) {
			const zeta = dampingRatio(token);
			expect(`${name}:${zeta <= 1.02}`).toBe(`${name}:true`);
		}
	});

	test("tokens that must not overshoot are critically damped", () => {
		// Rounding damping to a whole number moves ζ by well under a percent.
		for (const token of [
			SPRING_SWAP,
			SPRING_PANEL,
			SPRING_LAYOUT,
			SPRING_GLIDE,
		]) {
			expect(dampingRatio(token)).toBeCloseTo(1, 1);
		}
	});

	test("momentum-carrying tokens keep a little overshoot", () => {
		// A press release and a cursor follow both trail real movement.
		expect(dampingRatio(SPRING_PRESS)).toBeLessThan(1);
		expect(dampingRatio(SPRING_PRESS)).toBeGreaterThan(0.8);
		expect(dampingRatio(SPRING_MOUSE)).toBeLessThan(1);
		expect(dampingRatio(SPRING_MOUSE)).toBeGreaterThan(0.9);
	});

	test("the regression this file exists to prevent", () => {
		// The old shipped values, kept as an explicit tombstone.
		expect(
			dampingRatio({ stiffness: 420, damping: 40, mass: 0.5 })
		).toBeGreaterThan(1.3);
		expect(
			dampingRatio({ stiffness: 700, damping: 50, mass: 0.5 })
		).toBeGreaterThan(1.3);
		// ...and what we ship now.
		expect(SPRING_PANEL.damping).toBe(29);
		expect(SPRING_GLIDE.damping).toBe(37);
	});
});

describe("easing curves", () => {
	test("every curve is a well-formed cubic-bezier control pair", () => {
		for (const curve of [EASE_OUT, EASE_IN_OUT, EASE_DRAWER]) {
			expect(curve).toHaveLength(4);
			// CSS requires the two x controls to sit within [0, 1]; y may overshoot.
			expect(curve[0]).toBeGreaterThanOrEqual(0);
			expect(curve[0]).toBeLessThanOrEqual(1);
			expect(curve[2]).toBeGreaterThanOrEqual(0);
			expect(curve[2]).toBeLessThanOrEqual(1);
		}
	});

	test("EASE_OUT starts fast — entrances must respond immediately", () => {
		// A large first y-control for a small first x-control means most of the
		// distance is covered early.
		expect(EASE_OUT[1]).toBeGreaterThan(EASE_OUT[0]);
	});
});
