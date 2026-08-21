import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/reorder-indicator-proof.html";

test("renders rounded caps on tab, sidebar, and editor reorder markers", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-status",
		"pass"
	);
	await expect(page.locator("[data-reorder-line]")).toHaveCount(7);
	await expect
		.poll(() =>
			page
				.locator("[data-reorder-line]")
				.evaluateAll((indicators) =>
					indicators.every(
						(indicator) => getComputedStyle(indicator).borderRadius !== "0px"
					)
				)
		)
		.toBe(true);
});
