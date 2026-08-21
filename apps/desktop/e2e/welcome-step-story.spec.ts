import { expect, test } from "@playwright/test";

const STORY_URL = "/welcome-step-story.html";

test.describe("onboarding welcome step", () => {
	test("serves the entrypoint and every declared asset", async ({ page }) => {
		const documentResponse = await page.goto(STORY_URL);
		expect(documentResponse?.status()).toBe(200);

		const assetUrls = await page
			.locator("script[src], link[rel='stylesheet']")
			.evaluateAll((elements) =>
				elements
					.map(
						(element) =>
							element.getAttribute("src") ?? element.getAttribute("href")
					)
					.filter((url): url is string => Boolean(url))
			);

		expect(assetUrls.length).toBeGreaterThan(0);
		for (const assetUrl of assetUrls) {
			const assetStatus = await page.evaluate(async (url) => {
				const response = await fetch(url);
				return response.status;
			}, assetUrl);
			expect(assetStatus, `${assetUrl} should be served`).toBe(200);
		}
	});

	test("reveals the signature first and the Apple Hello loop second", async ({
		page,
	}) => {
		await page.goto(STORY_URL);

		await expect(page.getByRole("heading")).toContainText("Welcome to");
		await expect(page.getByTestId("onboarding-continue")).toHaveCount(0);

		const helloLoop = page.getByTestId("apple-hello-loop");
		await expect(helloLoop).toHaveAttribute("data-language", "English", {
			timeout: 7000,
		});
		await expect(page.getByRole("heading")).toHaveCount(0);
		await expect(page.getByTestId("onboarding-continue")).toBeVisible();

		await expect(helloLoop).toHaveAttribute("data-language", "Hindi", {
			timeout: 7000,
		});
	});

	test("the revealed Continue button exits the step", async ({ page }) => {
		await page.goto(STORY_URL);
		const continueButton = page.getByTestId("onboarding-continue");

		await expect(continueButton).toBeVisible({ timeout: 7000 });
		await continueButton.click();
		await expect(page.getByTestId("onboarding-status")).toHaveText("completed");
	});
});
