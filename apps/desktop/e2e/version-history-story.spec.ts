import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const PROOF_SCREENSHOT =
	process.env.RYU_VERSION_HISTORY_PROOF_SCREENSHOT ??
	"/tmp/ryu-spaces-version-history-proof.png";

test("previews and safely restores a Space page version", async ({ page }) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.setViewportSize({ height: 900, width: 1360 });
	await page.goto("/version-history-story.html");
	await page.getByRole("button", { name: /^History/ }).click();

	await expect(page.getByRole("button", { name: /^History 4/ })).toBeVisible();
	const reviewRow = page
		.locator("li")
		.filter({ hasText: "Editorial review" })
		.first();
	await expect(
		page.getByText("Editorial review", { exact: true }).first()
	).toBeVisible();
	await reviewRow.getByRole("button", { name: "Diff", exact: true }).click();
	await expect(
		page.getByText("- - Beta release", { exact: true })
	).toBeVisible();
	await expect(
		page.getByText("+ - General availability", { exact: true })
	).toBeVisible();

	await reviewRow.getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByTestId("status")).toHaveText(
		"Restored Editorial review · undo point saved"
	);

	await page.getByRole("button", { name: /^History/ }).click();
	await expect(
		page.getByText("Before restore", { exact: true }).first()
	).toBeVisible();
	await page.waitForTimeout(500);
	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
	expect(browserErrors).toEqual([]);
});
