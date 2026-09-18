import { expect, test } from "@playwright/test";

test("marketplace Health card exposes the installed runtime doctor", async ({
	page,
}) => {
	await page.goto("/plugin-doctor-scorecard-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");
	await expect(
		page.locator('[data-scorecard-ruleset="marketplace-plugin-2"]')
	).toBeVisible();
	await expect(
		page.locator('[data-scorecard-category="design-system"]')
	).toContainText("Ryu design system");
	await expect(
		page.locator('[data-scorecard-runtime-doctor="true"]')
	).toContainText("ryu plugin doctor com.example.mail");
	await expect(
		page.locator('[data-scorecard-runtime-doctor="true"]')
	).toContainText("does not execute plugin code");
	await expect(page.getByTestId("plugin-evals-card")).toContainText(
		"Behavioral evals"
	);
	await expect(page.getByTestId("plugin-evals-card")).toContainText(
		"Latest run 100/100"
	);
	await expect(page.getByTestId("plugin-evals-status")).toContainText("Ready");
	await page.screenshot({
		fullPage: true,
		path: "/tmp/ryu-plugin-doctor-design-system-proof.png",
	});
});
