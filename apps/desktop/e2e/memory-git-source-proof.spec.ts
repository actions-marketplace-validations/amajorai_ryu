import { expect, test } from "@playwright/test";

test("shows the explicit Git-backed Memory source controls", async ({
	page,
}) => {
	await page.goto("/memory-git-source-proof.html");
	await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();
	await expect(page.getByText("Git-backed memory")).toBeVisible();
	await expect(page.getByText("/Users/demo/memory-repo")).toBeVisible();
	await expect(page.getByText("main · 2 changed files")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Export Markdown" })
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Import changes" })
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Commit" })).toBeVisible();
	await page.screenshot({
		path: "e2e/proof/memory-git-source-proof.png",
		fullPage: true,
	});
});
