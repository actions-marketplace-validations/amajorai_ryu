// Real-browser spec for the picker-scroll story (`e2e/harness/
// picker-scroll-story.{html,tsx}`), which mounts the REAL `ComposerSettingsMenu`
// — the container behind the composer's agent picker — opening upward from a
// bottom-anchored trigger with more agent rows than any viewport can hold.
//
// The contract under test: a long agent list must stay REACHABLE. The shared menu
// popup (packages/ui dropdown-menu) caps itself at Base UI's `--available-height`
// and scrolls, so the last row has to be reachable by scrolling rather than
// rendered off the top of the window. This is the one property that reading the
// class list cannot confirm, because it depends on the positioner actually
// setting that variable at runtime.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/picker-scroll-story.html";

async function openPicker(page: Page) {
	await page.goto(STORY_URL);
	const trigger = page.getByTestId("picker-trigger");
	await expect(trigger).toBeVisible();
	await trigger.click();
	await expect(page.getByTestId("picker-body")).toBeVisible();
}

test("a long agent list caps to the available height instead of overflowing the window", async ({
	page,
}) => {
	await openPicker(page);
	const popup = page.locator('[data-slot="dropdown-menu-content"]');
	const box = await popup.boundingBox();
	expect(box).not.toBeNull();
	// The popup must sit inside the viewport, not run off the top of it.
	expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);

	const metrics = await popup.evaluate((el) => ({
		clientHeight: el.clientHeight,
		scrollHeight: el.scrollHeight,
		overflowY: getComputedStyle(el).overflowY,
		maxHeight: getComputedStyle(el).maxHeight,
	}));
	// Capped: the content is taller than the box that shows it…
	expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
	// …and that box is a scroller, so the overflow is reachable rather than lost.
	expect(["auto", "scroll"]).toContain(metrics.overflowY);
	expect(metrics.maxHeight).not.toBe("none");
});

test("the last agent row is reachable by scrolling the picker", async ({
	page,
}) => {
	await openPicker(page);
	const popup = page.locator('[data-slot="dropdown-menu-content"]');
	const lastRow = page.getByTestId("agent-row-59");

	await popup.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	// A scroll that moves nothing means the list is clipped, not scrollable.
	expect(await popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect(lastRow).toBeInViewport();
});

test("an ACP agent's advertised option list scrolls instead of running off screen", async ({
	page,
}) => {
	// The regression this locks down: `PopoverContent` sets no max-height, and the
	// shared composer popover class used to set none either — so an agent that
	// advertises 36 models (opencode does) rendered a 36-row popup that ran past
	// the top of the window with no way to reach the rows above the fold.
	await page.goto(STORY_URL);
	await page.getByRole("button", { exact: true, name: "Model" }).click();
	const popup = page.locator('[data-slot="popover-content"]');
	await expect(popup).toBeVisible();

	const box = await popup.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);

	const metrics = await popup.evaluate((el) => ({
		clientHeight: el.clientHeight,
		scrollHeight: el.scrollHeight,
		overflowY: getComputedStyle(el).overflowY,
	}));
	expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
	expect(["auto", "scroll"]).toContain(metrics.overflowY);

	await popup.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	expect(await popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect(
		page.getByRole("button", { name: "Provider 35 / Model 35" })
	).toBeInViewport();
});

test("the wheel scrolls the picker", async ({ page }) => {
	await openPicker(page);
	const popup = page.locator('[data-slot="dropdown-menu-content"]');
	// The gesture the user actually makes. Programmatic `scrollTop` proves the box
	// is a scroller; only a wheel event proves nothing upstream (a scroll lock, a
	// hover-driven scroll-into-view fighting the gesture) is eating it.
	const box = await popup.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(
		(box?.x ?? 0) + (box?.width ?? 0) / 2,
		(box?.y ?? 0) + (box?.height ?? 0) / 2
	);
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => popup.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
});
