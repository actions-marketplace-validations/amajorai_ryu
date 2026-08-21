import { expect, test } from "@playwright/test";

const STORY_URL = "/system-notifications-story.html";

test("shows the system notification completion matrix", async ({ page }) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-status",
		"pass"
	);
	await expect(page.getByTestId("notification-proof-row")).toHaveCount(4);
	await expect(page.getByText("App installed")).toBeVisible();
	await expect(page.getByText("Import complete")).toBeVisible();
	await expect(page.getByText("Thread imported")).toBeVisible();
	await expect(
		page.getByText("Other agents finished with issues")
	).toBeVisible();
});
