import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/appearance-chat-preview-proof.html";

test("proves the appearance controls, motion gate, and translucent chips", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("chat-preview")).toBeVisible();
	await expect(page.getByTestId("bot-mode-preview")).toBeVisible();
	await expect(
		page.getByTestId("chat-preview").locator('[aria-live="polite"]')
	).toHaveCount(1);
	await expect(
		page.getByTestId("bot-mode-preview").locator('[aria-live="polite"]')
	).toHaveCount(1);

	const statusChips = page.getByTestId("status-chips");
	await expect(statusChips).toHaveClass(/border-border\/30/);
	await expect(statusChips).toHaveClass(/bg-popover\/80/);
	await expect(statusChips).toHaveClass(/backdrop-blur/);

	await page.getByRole("switch", { name: "Enable animations" }).click();
	await expect(
		page.getByTestId("chat-preview").locator('[aria-live="polite"]')
	).toHaveCount(0);
	await expect(
		page.getByTestId("bot-mode-preview").locator('[aria-live="polite"]')
	).toHaveCount(0);

	await page
		.getByRole("switch", { name: "Show latest message / tool state" })
		.click();
	await expect(page.getByTestId("chat-row-single-line")).toBeVisible();
	await expect(page.getByTestId("bot-mode-preview")).toBeVisible();

	await page
		.getByRole("switch", { name: "Model & agent picker in tab bar actions" })
		.click();
	await expect(
		page.getByText("Picker in composer", { exact: true })
	).toBeVisible();
	await expect(page.getByTestId("proof-picker")).toBeVisible();

	await page.screenshot({
		path: testInfo.outputPath("appearance-chat-preview-proof.png"),
		fullPage: true,
	});
});
