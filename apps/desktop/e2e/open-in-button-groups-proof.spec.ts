import { expect, test } from "@playwright/test";

const STORY_URL = "/open-in-button-groups-proof.html";

test.describe("open-in ButtonGroups", () => {
	test.describe.configure({ timeout: 90_000 });

	test("renders the chat and workspace controls as ghost groups", async ({
		page,
	}) => {
		await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });

		const chatGroup = page.getByRole("group", { name: "Artifact actions" });
		await expect(chatGroup).toBeVisible();
		await expect(chatGroup.locator('[data-slot="button"]')).toHaveCount(2);
		await expect(
			chatGroup.locator('[data-slot="button-group-separator"]')
		).toHaveCount(1);
		await expect(
			chatGroup.getByRole("button", { exact: true, name: "Open" })
		).toHaveClass(/hover:bg-muted/);
		await expect(
			chatGroup.getByRole("button", { name: "Open in tab" })
		).toHaveClass(/hover:bg-muted/);

		const workspaceGroup = page.getByRole("group", {
			name: "Open project folder",
		});
		await expect(workspaceGroup).toBeVisible();
		await expect(workspaceGroup.locator("button")).toHaveCount(2);
		await expect(
			workspaceGroup.locator('[data-slot="button-group-separator"]')
		).toHaveCount(1);
		await expect(workspaceGroup.locator("button").nth(0)).toHaveClass(
			/hover:bg-muted/
		);
		await expect(workspaceGroup.locator("button").nth(1)).toHaveClass(
			/hover:bg-muted/
		);
		await page.screenshot({
			fullPage: true,
			path: "test-results/open-in-button-groups-proof.png",
		});
	});

	test("keeps both chat actions interactive and opens the editor menu", async ({
		page,
	}) => {
		await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Open in tab" }).click();
		await expect(page.getByTestId("proof-status")).toHaveText(
			"Chat: opened in tab"
		);

		await page.getByRole("button", { name: "Choose editor" }).click();
		await expect(page.getByRole("menu")).toBeVisible();
		await expect(page.getByRole("menuitem", { name: /Files/ })).toBeVisible();
	});
});
