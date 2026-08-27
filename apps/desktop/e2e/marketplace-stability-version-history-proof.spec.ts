import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/marketplace-stability-version-history-proof.html");
	await page.waitForSelector("body[data-harness-ready='1']");
});

test("proves the unstable filter, Installed composition, and version install affordance", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 960 });

	const filters = page.getByRole("button", { name: "Filters" });
	await filters.click();
	const unstable = page.getByRole("checkbox", {
		name: "Show unstable releases",
	});
	await expect(unstable).not.toBeChecked();
	await unstable.check();
	await expect(page.getByText("Beta Plugin")).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("marketplace-unstable-filter-checked.png"),
	});

	await page.getByRole("button", { name: "Installed only" }).click();
	await expect(page.getByText("Versioned Plugin")).toBeVisible();
	await expect(page.getByText("Beta Plugin")).toHaveCount(0);
	await page.getByRole("button", { name: "Installed only" }).click();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Beta Plugin" }).click();
	await page.getByRole("tab", { name: "Versions" }).click();
	const versionsPanel = page.getByRole("tabpanel");
	await expect(
		versionsPanel.getByText("Stable", { exact: true })
	).toBeVisible();
	await expect(versionsPanel.getByText("Beta", { exact: true })).toBeVisible();
	const installVersion = versionsPanel.getByRole("button", {
		name: "Install 1.5.0-beta.1",
	});
	await expect(installVersion).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("marketplace-version-history.png"),
	});

	await installVersion.click();
	await expect(
		page.getByRole("heading", { name: "Install 1.5.0-beta.1?" })
	).toBeVisible();
	await expect(
		page.getByText("Ryu will verify and install this exact version")
	).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("marketplace-version-history-confirm.png"),
	});
});
