import { expect, test } from "@playwright/test";

const STORY_URL = "/editor-toolbar-proof.html";

test("proves the page editor rail opens, nests, and returns", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("proof-status")).toHaveText(
		"Shared primitive mounted"
	);
	await expect(page.getByTestId("editor-surface-page")).toBeVisible();
	await expect(
		page.locator('[data-slot="nested-overflow-toolbar"]')
	).toHaveCount(1);

	await page
		.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open editor tools"]'
		)
		.click();
	await expect(
		page.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open Format tools"]'
		)
	).toBeVisible();

	await page
		.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open Format tools"]'
		)
		.click();
	await expect(
		page.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Back to editor tools"]'
		)
	).toBeVisible();
	await expect(
		page.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Bold (⌘+B)"]'
		)
	).toBeVisible();

	await page
		.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Back to editor tools"]'
		)
		.click();
	await expect(
		page.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open Blocks tools"]'
		)
	).toBeVisible();
});

test("uses the same rail in the skill editor and applies Markdown actions", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page
		.locator('nav[aria-label="Editor surface"] button:nth-child(2)')
		.click();

	await expect(page.getByTestId("editor-surface-skill")).toBeVisible();
	await expect(
		page.locator('[data-slot="nested-overflow-toolbar"]')
	).toHaveCount(1);
	await page
		.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open editor tools"]'
		)
		.click();
	await page
		.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Open Format tools"]'
		)
		.click();
	await expect(
		page.locator(
			'[data-slot="nested-overflow-toolbar"] button[aria-label="Back to editor tools"]'
		)
	).toBeVisible();

	const textarea = page.getByRole("textbox", {
		name: "Skill instructions (Markdown)",
	});
	await textarea.fill("hello");
	await textarea.press("ControlOrMeta+A");
	await page
		.locator('[data-slot="nested-overflow-toolbar"] button[aria-label="Bold"]')
		.click();
	await expect(textarea).toHaveValue("**hello**");
});
