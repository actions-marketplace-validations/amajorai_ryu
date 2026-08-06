// Real-browser spec for the store-listing detail shell
// (`e2e/harness/listing-detail-story.{html,tsx}`), which mounts the REAL
// `ListingDetailShell` + hero/stat-strip/gallery/rail primitives that every Store
// tab's preview dialog now renders inside.
//
// WHAT IT GUARDS, and why it needs a browser. The regression this layout replaced
// was purely geometric: the preview bodies were authored for a 26rem side pane
// that no caller can open any more, so at the dialog's real width they rendered as
// one thin column. The invariants below are all facts about resolved geometry —
// element widths, sibling ordering, scroll extents — which a type-check and a
// happy-dom render both answer "yes" to regardless of whether the CSS works.
//
//   1. TWO COLUMNS at dialog width. The Information rail must sit BESIDE the main
//      column, not under it. Asserted as "the rail's top is within the main
//      column's vertical span", which is true only when `lg:flex-row` applies.
//   2. NO HORIZONTAL PAGE SCROLL. The whole point of a wider dialog is defeated if
//      it overflows sideways. The stat strip (8 cells) and gallery (5 shots) are
//      both wider than the column and must scroll INSIDE their own band.
//   3. ONE COLUMN when narrow. Below the breakpoint the rail stacks under the main
//      column — the small-window presentation, which must not be a squeezed
//      two-up.

import { expect, test } from "@playwright/test";

const WIDE = { width: 1600, height: 1000 };
const NARROW = { width: 720, height: 1000 };

test.beforeEach(async ({ page }) => {
	await page.goto("/listing-detail-story.html");
	await page.waitForSelector("body[data-harness-ready='1']");
});

test("renders two columns at dialog width", async ({ page }) => {
	await page.setViewportSize(WIDE);
	const main = page.locator("main, [data-testid='dialog'] section").first();
	const rail = page.locator("aside").first();
	await expect(rail).toBeVisible();

	const mainBox = await main.boundingBox();
	const railBox = await rail.boundingBox();
	if (!(mainBox && railBox)) {
		throw new Error("missing layout boxes");
	}
	// Side by side: the rail starts to the RIGHT of the main column's right edge
	// (minus a tolerance for the gap), and vertically overlaps it.
	expect(railBox.x).toBeGreaterThan(mainBox.x + mainBox.width - 8);
	expect(railBox.y).toBeLessThan(mainBox.y + mainBox.height);
});

test("never scrolls the page sideways", async ({ page }) => {
	await page.setViewportSize(WIDE);
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test("stat strip scrolls inside its own band", async ({ page }) => {
	await page.setViewportSize(NARROW);
	// The strip is the only `overflow-x-auto` band directly under the action bar.
	const strip = page.locator("[data-testid='dialog'] .overflow-x-auto").first();
	const scrollable = await strip.evaluate(
		(el) => el.scrollWidth > el.clientWidth
	);
	expect(scrollable).toBe(true);
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test("stacks to one column when narrow", async ({ page }) => {
	await page.setViewportSize(NARROW);
	const main = page.locator("[data-testid='dialog'] section").first();
	const rail = page.locator("aside").first();
	const mainBox = await main.boundingBox();
	const railBox = await rail.boundingBox();
	if (!(mainBox && railBox)) {
		throw new Error("missing layout boxes");
	}
	expect(railBox.y).toBeGreaterThan(mainBox.y);
	expect(Math.abs(railBox.x - mainBox.x)).toBeLessThan(8);
});
