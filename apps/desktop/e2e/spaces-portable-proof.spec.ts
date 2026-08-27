import { expect, test } from "@playwright/test";

test("shows Space Markdown sharing controls", async ({ page }) => {
	await page.goto("/spaces-portable-proof.html");
	await expect(page.getByText("Share this Space")).toBeVisible();
	await expect(
		page.getByText(
			"Pages and database rows export as Markdown with frontmatter."
		)
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Export package" })
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Import package" })
	).toBeVisible();
	await page.screenshot({
		path: "e2e/proof/spaces-portable-proof.png",
		fullPage: true,
	});
});
