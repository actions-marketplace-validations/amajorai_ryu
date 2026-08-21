import { expect, test } from "@playwright/test";

const STORY_URL = "/onboarding-update-story.html";

test.describe("desktop onboarding update step", () => {
	test("shows the release and keeps the automatic update control visible", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await expect(page.getByTestId("desktop-update-status")).toContainText(
			"Update available"
		);
		await expect(page.getByText("Version 0.1.16 is ready")).toBeVisible();
		await expect(
			page.getByRole("switch", { name: "Check for updates automatically" })
		).toBeChecked();
		await expect(
			page.getByRole("button", { name: "Update now" })
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
	});

	test("allows the user to turn off auto-updates and continue", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await page
			.getByRole("switch", { name: "Check for updates automatically" })
			.click();
		await expect(
			page.getByRole("switch", { name: "Check for updates automatically" })
		).not.toBeChecked();

		await page.getByRole("button", { name: "Continue" }).click();
		await expect(page.getByTestId("onboarding-update-state")).toHaveText(
			"completed"
		);
	});
});
