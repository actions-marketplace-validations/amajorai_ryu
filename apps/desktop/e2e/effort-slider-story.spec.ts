// Real-browser spec for the effort-slider story (`e2e/harness/
// effort-slider-story.{html,tsx}`), which mounts the REAL `EffortSliderRow` inside
// a REAL `DropdownMenuContent`.
//
// The contract under test (from effort-slider-row.tsx):
//   • one detent per level the source advertises — five for Pi's `off … max`,
//     three for a shorter scale, never a hardcoded ladder;
//   • the track drags, and a drag to the far end commits the LAST level;
//   • Arrow keys move the VALUE, not the menu's row highlight — the menu owns
//     arrows for navigation, so the row has to stop them;
//   • changing the level leaves the menu open, matching every other setting in
//     this picker (`closeOnClick={false}` on the list rows).

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown + motion module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/effort-slider-story.html";

async function openMenu(page: Page) {
	await page.goto(STORY_URL);
	const trigger = page.getByRole("button", { name: "Agent" });
	await expect(trigger).toBeVisible();
	await trigger.click();
}

test("the detent count follows the advertised level list", async ({ page }) => {
	await openMenu(page);
	// aria-valuemax is the last index, so a five-level scale maxes at 4 and a
	// three-level one at 2. This is the assertion that a fixed low→xhigh ladder
	// would fail.
	await expect(page.getByRole("slider", { name: "Thinking" })).toHaveAttribute(
		"aria-valuemax",
		"4"
	);
	await expect(
		page.getByRole("slider", { name: "Reasoning effort" })
	).toHaveAttribute("aria-valuemax", "2");
});

test("the current level is announced by name, not by index", async ({
	page,
}) => {
	await openMenu(page);
	const slider = page.getByRole("slider", { name: "Thinking" });
	await expect(slider).toHaveAttribute("aria-valuenow", "2");
	await expect(slider).toHaveAttribute("aria-valuetext", "Medium");
});

test("arrow keys move the value and the menu stays open", async ({ page }) => {
	await openMenu(page);
	const slider = page.getByRole("slider", { name: "Thinking" });
	await slider.focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("five-value")).toHaveText("high");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByTestId("five-value")).toHaveText("low");
	// Still open — a nudge must not dismiss the picker.
	await expect(
		page.getByRole("slider", { name: "Reasoning effort" })
	).toBeVisible();
});

test("Home and End jump to the ends of the scale", async ({ page }) => {
	await openMenu(page);
	const slider = page.getByRole("slider", { name: "Thinking" });
	await slider.focus();
	await page.keyboard.press("End");
	await expect(page.getByTestId("five-value")).toHaveText("max");
	await page.keyboard.press("Home");
	await expect(page.getByTestId("five-value")).toHaveText("off");
});

test("dragging the track to the far end commits the last level", async ({
	page,
}) => {
	await openMenu(page);
	// The TRACK, not the thumb: the pointer handlers live on the track (drag
	// anywhere on it), and the thumb is a 6px bar with no room to drag across.
	const track = page.getByTestId("three").locator("[data-slot='slider']");
	const box = await track.boundingBox();
	expect(box).not.toBeNull();
	if (!box) {
		return;
	}
	await page.mouse.move(box.x + 4, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
		steps: 8,
	});
	await page.mouse.up();
	await expect(page.getByTestId("three-value")).toHaveText("high");
	// A drag that ends inside the menu must not dismiss it either.
	await expect(page.getByRole("slider", { name: "Thinking" })).toBeVisible();
});
