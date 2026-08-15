// Unit tests for the gesture physics helpers: velocity is measured across a
// window (not between the last two points), a flick projects further than a
// crawl, and boundaries resist progressively instead of stopping hard.

import { describe, expect, test } from "bun:test";
import {
	clampWithRubberband,
	createVelocityTracker,
	projectEndpoint,
	rubberband,
} from "./gesture.ts";

describe("createVelocityTracker", () => {
	test("returns 0 before there are two samples", () => {
		const track = createVelocityTracker();
		expect(track.velocity()).toBe(0);
		track.sample(10, 0);
		expect(track.velocity()).toBe(0);
	});

	test("measures signed velocity in units per second", () => {
		const track = createVelocityTracker();
		track.sample(0, 0);
		track.sample(50, 50); // 50 units in 50ms -> 1000 units/s
		expect(track.velocity()).toBe(1000);
	});

	test("reports negative velocity for a backwards gesture", () => {
		const track = createVelocityTracker();
		track.sample(100, 0);
		track.sample(50, 50);
		expect(track.velocity()).toBe(-1000);
	});

	test("ignores samples older than the window, so a stall reads as slow", () => {
		const track = createVelocityTracker();
		track.sample(0, 0); // far outside the window once time advances
		track.sample(500, 900);
		track.sample(505, 950);
		// Only the last two samples remain: 5 units in 50ms -> 100 units/s,
		// not the ~526 units/s the stale first sample would have implied.
		expect(track.velocity()).toBe(100);
	});

	test("survives duplicate timestamps instead of dividing by zero", () => {
		const track = createVelocityTracker();
		track.sample(0, 12);
		track.sample(40, 12);
		expect(track.velocity()).toBe(0);
	});

	test("reset clears the history", () => {
		const track = createVelocityTracker();
		track.sample(0, 0);
		track.sample(50, 50);
		track.reset();
		expect(track.velocity()).toBe(0);
	});
});

describe("projectEndpoint", () => {
	test("a zero-velocity release lands exactly where it stopped", () => {
		expect(projectEndpoint(200, 0)).toBe(200);
	});

	test("projects forward in the direction of travel", () => {
		expect(projectEndpoint(200, 1000)).toBeGreaterThan(200);
		expect(projectEndpoint(200, -1000)).toBeLessThan(200);
	});

	test("a flick travels further than a crawl from the same position", () => {
		const crawl = projectEndpoint(0, 100);
		const flick = projectEndpoint(0, 2000);
		expect(flick).toBeGreaterThan(crawl);
	});

	test("uses the exponential-decay form Apple ships", () => {
		// v/1000 * d / (1 - d), d = 0.998  ->  1 * 0.998 / 0.002 = 499
		expect(projectEndpoint(0, 1000)).toBeCloseTo(499, 6);
	});

	test("a snappier deceleration rate projects a shorter distance", () => {
		expect(projectEndpoint(0, 1000, 0.99)).toBeLessThan(
			projectEndpoint(0, 1000, 0.998)
		);
	});
});

describe("rubberband", () => {
	test("no overshoot means no displacement", () => {
		expect(rubberband(0, 500)).toBe(0);
	});

	test("always follows the pointer less than 1:1", () => {
		expect(Math.abs(rubberband(100, 500))).toBeLessThan(100);
		expect(Math.abs(rubberband(-100, 500))).toBeLessThan(100);
	});

	test("resists more the further past the bound the pointer goes", () => {
		const near = rubberband(50, 500);
		const far = rubberband(400, 500);
		// Still moves outward...
		expect(far).toBeGreaterThan(near);
		// ...but gives up an ever larger share of the movement.
		expect(far / 400).toBeLessThan(near / 50);
	});

	test("is symmetric about the boundary", () => {
		expect(rubberband(-120, 500)).toBeCloseTo(-rubberband(120, 500), 10);
	});

	test("a degenerate dimension cannot produce NaN", () => {
		expect(rubberband(100, 0)).toBe(0);
	});
});

describe("clampWithRubberband", () => {
	test("passes values inside the bounds straight through", () => {
		expect(clampWithRubberband(300, 180, 480, 1200)).toBe(300);
		expect(clampWithRubberband(180, 180, 480, 1200)).toBe(180);
		expect(clampWithRubberband(480, 180, 480, 1200)).toBe(480);
	});

	test("gives a little past the maximum rather than stopping dead", () => {
		const stretched = clampWithRubberband(600, 180, 480, 1200);
		expect(stretched).toBeGreaterThan(480);
		expect(stretched).toBeLessThan(600);
	});

	test("gives a little past the minimum too", () => {
		const squeezed = clampWithRubberband(80, 180, 480, 1200);
		expect(squeezed).toBeLessThan(180);
		expect(squeezed).toBeGreaterThan(80);
	});
});
