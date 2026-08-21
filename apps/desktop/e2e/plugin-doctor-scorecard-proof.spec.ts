import { expect, test } from "@playwright/test";

test("marketplace Health card exposes the installed runtime doctor", async ({
	page,
}) => {
	await page.goto("/plugin-doctor-scorecard-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");
	await expect(
		page.locator('[data-scorecard-ruleset="marketplace-plugin-1"]')
	).toBeVisible();
	await expect(
		page.locator('[data-scorecard-runtime-doctor="true"]')
	).toContainText("ryu plugin doctor com.example.mail");
	await expect(
		page.locator('[data-scorecard-runtime-doctor="true"]')
	).toContainText("does not execute plugin code");
});
