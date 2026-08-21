import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/desktop-startup-selection-story.html");
	await expect(page.getByTestId("desktop-startup-chooser")).toBeVisible({
		timeout: 30_000,
	});
});

test("shows the macOS-like account chooser with signed-in accounts", async ({
	page,
}) => {
	await expect(page.getByTestId("startup-account-step")).toBeVisible();
	await expect(page.getByText("Jia Wei Ng", { exact: true })).toBeVisible();
	await expect(page.getByText("Studio account", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
});

test("continues from account selection to node selection", async ({ page }) => {
	await page.getByText("Studio account", { exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();

	await expect(page.getByTestId("startup-node-step")).toBeVisible();
	await expect(page.getByText("local", { exact: true })).toBeVisible();
	await expect(page.getByText("Studio Mac", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Use as default" })
	).toBeVisible();
});
