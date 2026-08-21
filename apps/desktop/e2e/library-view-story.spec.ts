import { expect, test } from "@playwright/test";

test.describe("declarative Library views", () => {
	test("renders board, table, and list projections from one row model", async ({
		page,
	}) => {
		await page.goto("/library-view-story.html");
		await expect(
			page.getByRole("heading", { name: "Library view proof" })
		).toBeVisible();
		await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
		await expect(
			page.getByRole("columnheader", { name: "Name" })
		).toBeVisible();
		await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
		await expect(page.getByText("Design brief")).toHaveCount(3);
		await expect(page).toHaveScreenshot("library-view-proof.png", {
			fullPage: true,
		});
	});
});
