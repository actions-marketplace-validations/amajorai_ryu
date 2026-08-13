// Real-browser spec for the seasonal-effects story
// (`e2e/harness/seasonal-effects-story.{html,tsx}`), which mounts the REAL
// `SeasonalParticles` over a copy of the titlebar's layering.
//
// WHAT IT GUARDS, and why it needs a browser. Three of the four ways this
// feature breaks are facts about resolved CSS that no unit test can reach:
//
//  1. The Christmas season falls as a text glyph ("*"), not an emoji, so it is
//     the one season with a COLOR. The ported original hardcoded `#fff`, which
//     is a perfectly invisible titlebar on a light theme — the same
//     one-theme-at-a-time blindness the app-icon spec exists for.
//  2. The particles must paint ABOVE the titlebar's background layer and BELOW
//     the tab row, or they either never appear or they scribble over tab
//     labels. That ordering is z-index arithmetic against a sibling, so it is
//     only true in a rendered tree.
//  3. Decoration must obey reduce-motion. The component refuses to render under
//     it, but the CSS guard is the backstop that has to hold on its own — and
//     a media query is only observable in a browser that can emulate it.
//
// The fourth (which season shows on which date) is pure logic and lives in
// src/components/layout/SeasonalEffects.test.ts instead.

import { expect, test } from "@playwright/test";

/** Perceived luminance (0–255) of a computed colour. Mirrors the app-icon spec:
 *  this app's tokens are oklch, whose first component is already perceptual
 *  lightness on 0–1, so reading it as if it were "r" would invert the result. */
function luminanceOf(color: string): number {
	const parts = color.match(/[\d.]+/g);
	if (!parts || parts.length < 3) {
		throw new Error(`unparseable colour: ${color}`);
	}
	const nums = parts.map(Number);
	if (color.startsWith("oklch")) {
		return nums[0] * 255;
	}
	const [r, g, b] = nums;
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 7 seasons × 30 particles, per theme column. */
const PARTICLES_PER_COLUMN = 7 * 30;

test.beforeEach(async ({ page }) => {
	await page.goto("/seasonal-effects-story.html");
	await expect(page.getByTestId("season-strip").first()).toBeVisible();
});

test("every season paints a full field of particles", async ({ page }) => {
	// 7 seasons × 2 themes.
	await expect(page.getByTestId("season-strip")).toHaveCount(14);
	await expect(page.locator(".ryu-seasonal-particle")).toHaveCount(
		PARTICLES_PER_COLUMN * 2
	);
});

test("particles sit above the bar background and below the tab row", async ({
	page,
}) => {
	const strip = page.getByTestId("season-strip").first();

	const layerZ = await strip
		.locator(".ryu-seasonal-particle")
		.first()
		.evaluate((el) => {
			const layer = el.parentElement;
			return layer ? Number(getComputedStyle(layer).zIndex) : Number.NaN;
		});
	const tabRowZ = await strip
		.getByTestId("tab-row")
		.evaluate((el) => Number(getComputedStyle(el).zIndex));

	// Above the background layer (which is z-auto, painted earlier in DOM order)
	// and strictly below the controls, so no emoji ever lands on a tab label.
	expect(layerZ).toBeGreaterThan(0);
	expect(layerZ).toBeLessThan(tabRowZ);
});

test("the snowflake glyph stays visible in BOTH themes", async ({ page }) => {
	for (const [theme, expected] of [
		["light", "dark"],
		["dark", "light"],
	] as const) {
		const flake = page
			.locator(`.${theme} [data-season="christmas"] .ryu-seasonal-particle`)
			.first();
		const color = await flake.evaluate((el) => getComputedStyle(el).color);
		const lum = luminanceOf(color);

		if (expected === "dark") {
			// Light theme: white snow on a near-white titlebar is a blank bar. The
			// hardcoded `#fff` this was ported from fails right here.
			expect(lum, `${theme} snowflake (${color})`).toBeLessThan(200);
		} else {
			expect(lum, `${theme} snowflake (${color})`).toBeGreaterThan(200);
		}
	}
});

test("reduce-motion removes the particles entirely", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const display = await page
		.locator(".ryu-seasonal-particle")
		.first()
		.evaluate((el) => getComputedStyle(el).display);
	expect(display).toBe("none");
});
