import { expect, test } from "@playwright/test";

const STORY_URL = "/onboarding-defaults-profile-proof.html";

test.describe("onboarding defaults and profile bootstrap proof", () => {
	test("shows separate local and paid cloud lanes", async ({ page }) => {
		await page.goto(STORY_URL);
		await expect(page.getByTestId("defaults-stage")).toBeVisible();
		await expect(page.getByTestId("lane-local")).toContainText("Gemma 4");
		await expect(page.getByTestId("lane-local")).toContainText("local");
		await expect(page.getByTestId("lane-cloud")).toContainText(
			"openrouter/auto"
		);
		await expect(page.getByTestId("lane-cloud")).toContainText("Ryu");
	});

	test("connects multiple sources and searches the catalog", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await page.getByRole("button", { name: /Connections/ }).click();
		await expect(page.getByTestId("connection-gmail")).toContainText(
			"Connected"
		);
		await page
			.getByTestId("connection-notion")
			.getByRole("button", { exact: true, name: "Connect" })
			.click();
		await expect(page.getByTestId("connection-notion")).toContainText(
			"Connected"
		);
		await page.getByLabel("Search connections").fill("GitHub");
		await expect(page.getByTestId("connection-github")).toBeVisible();
		await expect(page.getByTestId("connection-gmail")).toHaveCount(0);
	});

	test("keeps auto import on and materializes the profile chat in background", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await page.getByRole("button", { name: /Import threads/ }).click();
		await expect(page.getByTestId("imports-stage")).toContainText("18");
		await expect(page.getByLabel("Auto-import new threads")).toBeChecked();
		await page.getByRole("button", { name: "Confirm import" }).click();
		await expect(
			page.getByRole("button", { name: /Imported 18/ })
		).toBeVisible();

		await page.getByRole("button", { name: /Build profile/ }).click();
		await expect(page.getByTestId("profile-stage")).toContainText(
			"user + organization"
		);
		await page.getByRole("button", { name: "Run in background" }).click();
		await expect(page.getByTestId("profile-stage")).toContainText(
			"Chat created"
		);
		await expect(page.getByTestId("profile-stage")).toContainText(
			"resume the stream"
		);
	});
});
