// Real-browser spec for the timezone-picker story (`e2e/harness/
// timezone-picker-story.{html,tsx}`), which mounts the REAL Appearance
// "Date & time" row — the app's only `Combobox` consumer.
//
// The contract under test:
//   • the trigger shows the human LABEL ("(GMT+09:00) Asia/Tokyo"), never the
//     raw stored id — the failure mode when the item stringifier is missing;
//   • typing filters against that same label, so a city name finds its zone;
//   • picking a zone reaches the shared formatters, not just the trigger — the
//     sample stamp beside the row is formatted by `formatDateTime`;
//   • the choice survives a reload, because it is persisted.
//
// The popup's search input is mounted and unmounted with the popup, so every
// open waits for a FRESH input: typing into the one still on its way out is a
// race that silently filters the wrong list.

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the settings + combobox module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/timezone-picker-story.html";
const SEARCH_PLACEHOLDER = "Search a city or zone…";

const trigger = (page: Page) =>
	page.locator("[data-slot='combobox-trigger']").first();

async function load(page: Page) {
	await page.goto(STORY_URL);
	await expect(trigger(page)).toBeVisible();
}

/** Open the popup and type `query`, waiting out the previous popup first. */
async function search(page: Page, query: string) {
	const input = page.getByPlaceholder(SEARCH_PLACEHOLDER);
	await expect(input).toHaveCount(0);
	await trigger(page).click();
	await expect(input).toBeVisible();
	await input.fill(query);
}

test("defaults to System and shows a label, not a raw zone id", async ({
	page,
}) => {
	await load(page);
	await expect(trigger(page)).toContainText("System (");
});

test("filters by city name and commits the picked zone", async ({ page }) => {
	await load(page);
	await search(page, "tokyo");

	// Filtering runs against the offset-prefixed label, so a bare city name has
	// to match — this is the assertion a missing `itemToStringLabel` fails.
	const option = page.getByRole("option", { name: /Asia\/Tokyo/ });
	await expect(option).toHaveCount(1);
	await option.click();

	await expect(trigger(page)).toContainText("(GMT+09:00) Asia/Tokyo");
});

test("the picked zone reaches the shared formatters", async ({ page }) => {
	await load(page);
	const stamp = page.getByTestId("sample-stamp");

	await search(page, "tokyo");
	await page.getByRole("option", { name: /Asia\/Tokyo/ }).click();

	// 2026-01-15T23:30Z is 2026-01-16 08:30 in Tokyo: both the clock AND the
	// calendar day move, which is what makes this more than a re-label.
	await expect(stamp).toContainText("08:30");
	await expect(stamp).toContainText(/\b16\b/);

	await search(page, "Los Angeles");
	await page.getByRole("option", { name: /America\/Los Angeles/ }).click();

	// Same instant, the previous calendar day, seven hours earlier than Tokyo's
	// clock minus the date rollover.
	await expect(stamp).toContainText("15:30");
	await expect(stamp).toContainText(/\b15\b/);
});

test("the choice survives a reload", async ({ page }) => {
	await load(page);
	await search(page, "tokyo");
	await page.getByRole("option", { name: /Asia\/Tokyo/ }).click();
	await expect(trigger(page)).toContainText("Asia/Tokyo");

	await page.reload();
	await expect(trigger(page)).toContainText("Asia/Tokyo");
});
