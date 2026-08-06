// Real-browser spec for the app-icon story (`e2e/harness/app-icon-story.{html,tsx}`),
// which mounts the REAL `AppIcon` — the single icon square shared by the Store
// lists, the Installed tab, the sidebar, the workspace tab strips and the composer
// "+" menu.
//
// WHAT IT GUARDS, and why it needs a browser. Every packaged manifest declares the
// standard wash `{from: <hue>, to: "transparent", direction: "down"}`. That ramp
// covers only the TOP of the square: its bottom dissolves to whatever surface is
// behind it. `AppIcon` therefore picks the glyph colour from whether the dither
// dissolves — `text-foreground` when it does, `text-white` only for an opaque
// two-tone ramp.
//
// Hardcoding white there is the regression this spec exists to catch, and it is
// invisible in a single-theme check: white-on-dissolved reads perfectly on a dark
// card and disappears entirely on a light one. So the assertion is that the glyph
// resolves to a DARK colour in the light column and a LIGHT one in the dark column
// — a fact about resolved CSS, which only a real browser can answer. The glyph is
// painted by `Icon` as a CSS mask with `background-color: currentColor`, so the
// resolved foreground is readable straight off the element.

import { expect, test } from "@playwright/test";

/** Perceived luminance (0–255) of a computed colour.
 *
 *  Handles `oklch(...)` as well as `rgb(...)`, and that is not incidental: this
 *  app's design tokens ARE oklch, so `getComputedStyle` hands back
 *  `oklch(0.145 0 0)` for the light-theme foreground. Reading those three numbers
 *  as if they were r/g/b yields 0.29 for a colour that is in fact near-WHITE in
 *  dark theme — an inverted reading that would fail a correct render and pass a
 *  broken one. In oklch the first component is already perceptual lightness on
 *  0–1, so it scales straight onto the same 0–255 scale. */
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

/** Comfortably clear of mid-grey, so the assertion fails on a washed-out glyph
 *  rather than only on a perfectly inverted one. */
const DARK_MAX = 110;
const LIGHT_MIN = 145;

test.beforeEach(async ({ page }) => {
	await page.goto("/app-icon-story.html");
	await expect(page.getByTestId("tile").first()).toBeVisible();
});

test("every icon square paints its wash and a glyph", async ({ page }) => {
	const tiles = page.getByTestId("tile");
	// 9 sample manifests × 2 themes.
	await expect(tiles).toHaveCount(18);
	// The dither is a <canvas>; one per square proves the wash actually painted.
	await expect(page.locator('[data-testid="tile"] canvas')).toHaveCount(18);
});

test("the glyph stays legible in BOTH themes over the dissolving wash", async ({
	page,
}) => {
	for (const [theme, bound] of [
		["light", "dark"],
		["dark", "light"],
	] as const) {
		// The glyph itself, not its wrapper: `Icon` paints a CSS mask and colours it
		// with `currentColor`, so this element — and only this element — resolves the
		// foreground the tile actually shows. Matching the wrapper instead reads
		// `rgba(0,0,0,0)`, which passes a "dark enough" check for the wrong reason.
		const glyphs = page.locator(
			`.${theme} [data-testid="tile"] span[style*="mask-image"]`
		);
		const count = await glyphs.count();
		expect(count).toBeGreaterThan(0);

		for (let i = 0; i < count; i++) {
			const color = await glyphs
				.nth(i)
				.evaluate((el) => getComputedStyle(el).backgroundColor);
			const lum = luminanceOf(color);
			if (bound === "dark") {
				// Light theme: the wash fades to a near-white surface, so the glyph
				// must be dark. A hardcoded `text-white` fails here.
				expect(lum, `${theme} glyph ${i} (${color})`).toBeLessThan(DARK_MAX);
			} else {
				expect(lum, `${theme} glyph ${i} (${color})`).toBeGreaterThan(
					LIGHT_MIN
				);
			}
		}
	}
});
