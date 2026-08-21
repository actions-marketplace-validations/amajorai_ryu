import { expect, test } from "@playwright/test";

test("catalog scorecards expose the configured-agent review", async ({
	page,
}) => {
	await page.goto("/catalog-scan-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");
	await expect(
		page.getByText("Gateway → Guardrails → Catalog scanner")
	).toBeVisible();
	await expect(
		page.locator('[data-scorecard-ruleset="marketplace-plugin-1"]')
	).toBeVisible();
	await expect(
		page.locator('[data-scorecard-ruleset="marketplace-skill-1"]')
	).toBeVisible();

	const scanButtons = page.getByTestId("catalog-scan-button");
	await expect(scanButtons).toHaveCount(2);
	await scanButtons.first().click();
	await expect(page.getByTestId("catalog-scan-result").first()).toContainText(
		"Reviewed by catalog-reviewer"
	);
});
