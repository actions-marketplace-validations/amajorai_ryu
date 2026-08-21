import { expect, test } from "@playwright/test";

test("agent sync renders the operation and ACP proof", async ({ page }) => {
	await page.goto("/agent-sync-proof.html");

	await expect(page.getByText("Claude · selected")).toBeVisible();
	await page.getByRole("button", { name: "Use" }).first().click();
	await page.getByLabel("Destination folder").fill("/Users/jiawei/.claude");
	await page.getByRole("button", { name: "Export bundle" }).click();

	await expect(page.getByText("export_fixture_001")).toBeVisible();
	await expect(
		page.getByText(
			"4e9d8c2f0a36e2b5b4ac3e9b3e6d6d4e0c8b9a4d2e1f7a6c5b4d3e2f1a0b9c8"
		)
	).toBeVisible();
	await expect(
		page.getByText("12 items imported · 4 skipped · 0 failed")
	).toBeVisible();
	await expect(
		page.getByText("4 agents · 7 skills · 2 conversations · 28 messages")
	).toBeVisible();
	await expect(
		page.getByText("source b7a8f1d2c3e4 · generated 4e9d8c2f0a36")
	).toBeVisible();
	await expect(
		page.getByText("1 ACP loads/resumes · 1 transcript replays")
	).toBeVisible();

	await page.getByRole("button", { name: "Test ACP resume/load" }).click();
	await expect(
		page.getByText("1 ACP sessions loaded/resumed, 1 transcript replays.")
	).toBeVisible();
});
