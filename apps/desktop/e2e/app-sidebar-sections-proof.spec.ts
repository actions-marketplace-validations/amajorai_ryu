// Browser proof for the app-owned record pickers that now use the desktop
// sidebar contribution primitive instead of shipping their own primary rail.

import { expect, test } from "@playwright/test";

const STORY_URL = "/app-sidebar-sections-proof.html";

test.describe("app-owned sidebar sections", () => {
	test("renders all migrated record pickers through the shared section", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		for (const title of [
			"Plans",
			"Monitors",
			"Policies",
			"Contexts",
			"Inboxes",
			"Workflows",
		]) {
			await expect(page.getByText(title, { exact: true })).toBeVisible();
		}
		for (const item of [
			"Launch plan",
			"Production API",
			"Release policy",
			"Q3 contracts",
			"Support",
			"Release workflow",
		]) {
			await expect(page.getByText(item, { exact: true })).toBeVisible();
		}
	});

	test("opens a migrated row through its declarative item target", async ({
		page,
	}) => {
		await page.goto(STORY_URL);
		await page.getByRole("button", { name: /Release workflow/ }).click();
		await expect(page.locator("#opened")).toHaveText("/workflows/workflow-1");
	});
});
