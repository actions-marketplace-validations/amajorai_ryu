import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("shows usage for ACP and Ryu subscription providers in one dialog", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			"ryu:usage-bar-prefs",
			JSON.stringify({
				barStyle: "ring",
				mode: "remaining",
				showBar: true,
				showPercent: false,
				sidebar: true,
				visible: true,
			})
		);
	});
	await page.goto("/ryu-provider-usage-proof.html");
	await page.getByTestId("usage-proof-trigger").click();

	await expect(page.getByTestId("usage-proof-acp")).toBeVisible();
	await expect(page.getByTestId("usage-proof-ryu-claude")).toBeVisible();
	await expect(page.getByTestId("usage-proof-ryu-codex")).toBeVisible();
	await expect(page.getByTestId("usage-proof-ryu-copilot")).toBeVisible();
	await expect(page.getByLabel("Session: 72% left")).toBeVisible();
	await expect(page.getByLabel("Weekly: 38% left")).toBeVisible();
	await expect(page.getByLabel("Session: 66% left")).toBeVisible();
	await expect(page.getByLabel("Weekly: 42% left")).toBeVisible();
	await expect(page.getByLabel("Rate limit resets: 3/10")).toBeVisible();
	await expect(page.getByLabel("Session: 59% left")).toBeVisible();
	await expect(page.getByLabel("Weekly: 27% left")).toBeVisible();
	await expect(page.getByLabel("Credits: 81% left")).toBeVisible();
	await expect(
		page
			.getByTestId("usage-proof-ryu-claude")
			.locator('svg[viewBox="0 0 16 16"]')
	).toHaveCount(2);
	await expect(
		page
			.getByTestId("usage-proof-ryu-codex")
			.locator('svg[viewBox="0 0 16 16"]')
	).toHaveCount(2);
});
