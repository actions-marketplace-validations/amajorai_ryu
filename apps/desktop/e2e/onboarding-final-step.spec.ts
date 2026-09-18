import { expect, test } from "@playwright/test";

const STORY_URL = "/onboarding-final-step-story.html";

test.describe("onboarding final step", () => {
	test("renders the merged guidance and privacy choices without a dialog", async ({
		page,
	}) => {
		const documentResponse = await page.goto(STORY_URL);
		expect(documentResponse?.status()).toBe(200);

		await expect(
			page.getByRole("heading", { name: "A few things to know" })
		).toBeVisible();
		await expect(page.getByText("Can take actions for you")).toBeVisible();
		await expect(
			page.getByText("Can keep working in the background")
		).toBeVisible();
		await expect(page.getByText("You stay in control")).toBeVisible();
		await expect(page.getByText("How Ryu handles your data")).toBeVisible();
		await expect(page.getByText("Choose your privacy settings")).toBeVisible();
		await expect(page.getByRole("switch")).toHaveCount(4);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByTestId("onboarding-final-continue")).toHaveText(
			"Get started"
		);
	});

	test("allows a privacy choice and completes from the merged screen", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		const analyticsSwitch = page.getByRole("switch").first();
		await expect(analyticsSwitch).toBeChecked();
		await analyticsSwitch.click();
		await expect(analyticsSwitch).not.toBeChecked();

		await page.getByTestId("onboarding-final-continue").click();
		await expect(page.getByTestId("onboarding-status")).toHaveText("completed");
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: "e2e/artifacts/onboarding-final-step-completed.png",
		});
	});
});
