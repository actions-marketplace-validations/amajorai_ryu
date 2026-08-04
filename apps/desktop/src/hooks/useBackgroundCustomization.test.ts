// apps/desktop/src/hooks/useBackgroundCustomization.test.ts
//
// Guards the two invariants that can silently break persisted setups:
//   1. Old two-stop gradients (`gradientFrom`/`gradientTo` in localStorage)
//      migrate to the stops array unchanged.
//   2. Transparency + backdrop blur are exposed as CSS vars and flip the
//      `data-ryu-bg-active` flag the surface ::before layer keys off — and a
//      fully-default surface must never leave that flag on.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom registers a single global DOM per process; when several test files
// register it in one `bun test` run, the later calls throw "already registered".
if (typeof globalThis.window === "undefined") {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import {
	buildGradientCss,
	DEFAULT_SURFACE_BACKGROUND,
	loadSurfaceBackground,
	resetBackgroundCustomization,
	setSurfaceBackground,
} from "./useBackgroundCustomization.ts";

beforeEach(() => {
	localStorage.clear();
	resetBackgroundCustomization();
});

describe("legacy two-stop gradient migration", () => {
	test("gradientFrom/gradientTo become stops at 0% and 100%", () => {
		localStorage.setItem(
			"ryu:bg:sidebar",
			JSON.stringify({
				gradientEnabled: true,
				gradientFrom: "#ff0000",
				gradientTo: "#0000ff",
			})
		);
		const bg = loadSurfaceBackground("sidebar");
		expect(bg.gradientStops).toEqual([
			{ color: "#ff0000", position: 0 },
			{ color: "#0000ff", position: 100 },
		]);
		expect(bg.gradientEnabled).toBe(true);
	});

	test("a stored stops array is preserved", () => {
		const stops = [
			{ color: "#ff0000", position: 0 },
			{ color: "#00ff00", position: 40 },
			{ color: "#0000ff", position: 100 },
		];
		localStorage.setItem(
			"ryu:bg:sidebar",
			JSON.stringify({ gradientStops: stops })
		);
		expect(loadSurfaceBackground("sidebar").gradientStops).toEqual(stops);
	});

	test("malformed stop entries are dropped and replaced with the defaults", () => {
		localStorage.setItem(
			"ryu:bg:sidebar",
			JSON.stringify({
				gradientStops: [{ color: "#ff0000" }, "nope"],
			})
		);
		const bg = loadSurfaceBackground("sidebar");
		expect(bg.gradientStops).toEqual(DEFAULT_SURFACE_BACKGROUND.gradientStops);
	});
});

describe("buildGradientCss", () => {
	test("sorts stops by position regardless of insertion order", () => {
		const css = buildGradientCss(
			[
				{ color: "#0000ff", position: 100 },
				{ color: "#00ff00", position: 50 },
				{ color: "#ff0000", position: 0 },
			],
			45
		);
		expect(css).toBe(
			"linear-gradient(45deg, rgba(255, 0, 0, 1) 0%, rgba(0, 255, 0, 1) 50%, rgba(0, 0, 255, 1) 100%)"
		);
	});
});

describe("transparency + backdrop blur wiring", () => {
	test("transparency and blur set the CSS vars and flag the surface active", () => {
		setSurfaceBackground("sidebar", {
			...DEFAULT_SURFACE_BACKGROUND,
			gradientEnabled: true,
			transparency: 40,
			backdropBlur: 12,
		});
		const style = document.documentElement.style;
		expect(style.getPropertyValue("--ryu-sidebar-bg-opacity")).toBe("0.6");
		expect(style.getPropertyValue("--ryu-sidebar-bg-blur")).toBe("12px");
		expect(document.documentElement.getAttribute("data-ryu-bg-active")).toBe(
			"true"
		);
	});

	test("a fully-default surface stays inactive", () => {
		setSurfaceBackground("sidebar", { ...DEFAULT_SURFACE_BACKGROUND });
		expect(
			document.documentElement.getAttribute("data-ryu-bg-active")
		).toBeNull();
	});
});
