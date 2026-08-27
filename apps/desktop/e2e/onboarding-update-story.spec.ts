import { expect, test } from "@playwright/test";

const STORY_URL = "/onboarding-update-story.html";

test.describe("desktop onboarding update step", () => {
	test("shows the prepared release and keeps automatic downloading visible", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await expect(page.getByTestId("desktop-update-status")).toContainText(
			"Update available"
		);
		await expect(page.getByText("Version 0.1.16 is ready")).toBeVisible();
		await expect(
			page.getByRole("switch", {
				name: "Download app updates automatically",
			})
		).toBeChecked();
		await expect(
			page.getByRole("button", { name: "Install and restart" })
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
	});

	test("allows the user to turn off automatic downloads and continue", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await page
			.getByRole("switch", { name: "Download app updates automatically" })
			.click();
		await expect(
			page.getByRole("switch", {
				name: "Download app updates automatically",
			})
		).not.toBeChecked();

		await page.getByRole("button", { name: "Continue" }).click();
		await expect(page.getByTestId("onboarding-update-state")).toHaveText(
			"completed"
		);
	});
});
