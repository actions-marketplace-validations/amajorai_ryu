import { expect, test } from "@playwright/test";

test("shows discounted OpenRouter picker prices and managed accounting", async ({
	page,
}) => {
	await page.goto("/model-pricing-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");
	await expect(
		page.getByRole("heading", { name: "Discount-aware model pricing" })
	).toBeVisible();
	await expect(page.getByTestId("model-row-openai/gpt-5.6-sol")).toContainText(
		"2.50 / 15.00 / 1M"
	);
	await expect(page.getByTestId("price-preview")).toContainText(
		"Current OpenRouter transaction price"
	);
	const scoreBars = page
		.getByTestId("price-preview")
		.locator('[data-slot="model-score-bar"]');
	await expect(scoreBars).toHaveCount(4);
	await expect(scoreBars.nth(0)).toHaveAttribute("data-score", "2");
	await expect(scoreBars.nth(0)).toHaveAttribute("data-filled-pips", "2");
	await expect(
		scoreBars.nth(0).locator('[data-slot="model-score-pip"]')
	).toHaveCount(5);
	await expect(
		scoreBars
			.nth(0)
			.locator('[data-slot="model-score-pip"][data-filled="true"]')
	).toHaveCount(2);
	await expect(page.getByTestId("price-preview")).toContainText("In $2.50 /1M");
	await expect(page.getByTestId("price-preview")).toContainText(
		"Out $15.00 /1M"
	);
	await expect(page.getByTestId("accounting-proof")).toContainText(
		"provider_cost_micro_usd=1250"
	);

	await page.getByTestId("model-row-anthropic/claude-sonnet-4").click();
	await expect(page.getByTestId("price-preview")).toContainText("In $3.00 /1M");
	await expect(page.getByTestId("price-preview")).toContainText(
		"Out $15.00 /1M"
	);
});
