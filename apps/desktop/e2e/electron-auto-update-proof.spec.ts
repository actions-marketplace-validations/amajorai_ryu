import { expect, test } from "@playwright/test";

const STORY_URL = "/electron-auto-update-proof.html";

test("renders the automatic Electron update contract", async ({ page }) => {
	await page.goto(STORY_URL);
	await expect(
		page.getByRole("heading", { name: "No Next / Continue wizard" })
	).toBeVisible();
	await expect(page.getByTestId("proof-status")).toHaveText("Verified");
	await expect(page.locator('[data-status="pass"]')).toHaveCount(4);
	await expect(
		page.getByText("Windows may still show a UAC consent prompt")
	).toBeVisible();
	await page.screenshot({
		path: "apps/desktop/e2e/harness/electron-auto-update-proof.png",
		fullPage: true,
	});
});
