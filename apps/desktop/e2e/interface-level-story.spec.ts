// Real-browser spec for the interface-level story (`e2e/harness/
// interface-level-story.{html,tsx}`), which mounts the REAL
// `InterfaceLevelSubmenu` inside a REAL account-shaped dropdown.
//
// The contract under test:
//   • four detents, one per level (Simple · Standard · Advanced · Expert), with
//     Simple as the default an untouched install lands on;
//   • the fill uses the SHARED level ramp — green at the bottom, purple at the
//     top. The ramp's top stop is a CSS variable declared by `LEVEL_RAMP_CLASS`,
//     so a missing class does not dull the fill, it deletes it;
//   • Arrow keys move the VALUE, not the menu's row highlight, and the menu
//     stays open — a slider inside a menu has to trap keys and not be an item;
//   • moving the ladder WRITES the prefs it implies (Detail level "None" at
//     Simple, run stats only at Expert) rather than shadowing them.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown + motion module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/interface-level-story.html";

async function openLadder(page: Page) {
	await page.goto(STORY_URL);
	const trigger = page.getByRole("button", { name: "Account" });
	await expect(trigger).toBeVisible();
	await trigger.click();
	// The ladder lives one level down, behind its own sub-trigger.
	await page.getByText("Interface level").click();
	await expect(
		page.getByRole("slider", { name: "Interface level" })
	).toBeVisible();
}

test("the ladder has one detent per level and starts on Simple", async ({
	page,
}) => {
	await openLadder(page);
	const slider = page.getByRole("slider", { name: "Interface level" });
	await expect(slider).toHaveAttribute("aria-valuemax", "3");
	await expect(slider).toHaveAttribute("aria-valuenow", "0");
	await expect(slider).toHaveAttribute("aria-valuetext", "Simple");
});

test("arrow keys move the value and the menu stays open", async ({ page }) => {
	await openLadder(page);
	const slider = page.getByRole("slider", { name: "Interface level" });
	await slider.focus();
	await page.keyboard.press("ArrowRight");
	await expect(slider).toHaveAttribute("aria-valuetext", "Standard");
	await page.keyboard.press("End");
	await expect(slider).toHaveAttribute("aria-valuetext", "Expert");
	// Still open — a nudge must not dismiss the menu it lives in.
	await expect(slider).toBeVisible();
});

test("moving the ladder writes the prefs it implies", async ({ page }) => {
	await openLadder(page);
	const slider = page.getByRole("slider", { name: "Interface level" });
	await slider.focus();

	// Expert: the full transcript, commands expanded, run stats on.
	await page.keyboard.press("End");
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("expert");
	await expect(page.getByTestId("ryu:hide-tool-detail")).toHaveText("false");
	await expect(page.getByTestId("ryu:expand-commands")).toHaveText("true");
	await expect(page.getByTestId("ryu:inference-stats")).toHaveText("true");

	// Back to Simple: nothing expanded, no tool detail at all, stats back off.
	await page.keyboard.press("Home");
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("simple");
	await expect(page.getByTestId("ryu:hide-tool-detail")).toHaveText("true");
	await expect(page.getByTestId("ryu:expand-commands")).toHaveText("false");
	await expect(page.getByTestId("ryu:inference-stats")).toHaveText("false");
});

/**
 * The fill's own computed colour, read back after the cross-fade settles. It is
 * built from `color-mix` over theme vars, and an invalid mix does not fall back
 * to something duller — the declaration is dropped and the fill goes colourless.
 */
async function fillColor(page: Page): Promise<string> {
	await page.waitForTimeout(500);
	return await page
		.locator("[data-slot='slider'] > div")
		.first()
		.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** oklab components of a computed colour, or null when it is not painted. */
function oklab(color: string): { a: number; alpha: number; b: number } | null {
	const m = color.match(
		/^oklab\(\s*[\d.]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\/\s*([\d.]+)\s*\)$/
	);
	return m ? { a: Number(m[1]), b: Number(m[2]), alpha: Number(m[3]) } : null;
}

test("the fill uses the shared ramp: green low, purple at Expert", async ({
	page,
}) => {
	await openLadder(page);
	const slider = page.getByRole("slider", { name: "Interface level" });
	await slider.focus();

	// Standard — the first level that paints. Negative a is the green side.
	await page.keyboard.press("ArrowRight");
	const low = oklab(await fillColor(page));
	expect(low?.alpha).toBeGreaterThan(0);
	expect(low?.a).toBeLessThan(0);

	// Expert — purple: b crosses to the blue side, which no other stop does. This
	// is the assertion a missing `LEVEL_RAMP_CLASS` fails, since the top stop's
	// variable would resolve to nothing and drop the whole colour.
	await page.keyboard.press("End");
	const top = oklab(await fillColor(page));
	expect(top?.alpha).toBeGreaterThan(0);
	expect(top?.b).toBeLessThan(0);
});
