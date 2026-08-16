import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-selection-toast-story.html";

test("stays quiet while idle", async ({ page }) => {
	await page.goto(STORY_URL);
	await page.getByTestId("change-effort").click();
	await expect(page.getByText("Effort: High")).toHaveCount(0);
});

test("uses the selected timing while the agent is working", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page.getByTestId("working-toggle").click();
	await page.getByTestId("change-effort").click();
	await expect(page.getByText("Effort: High")).toBeVisible();
	await expect(page.getByText("Applies on the next turn.")).toBeVisible();

	await page.getByTestId("apply-mode").selectOption("next-user-message");
	await page.getByTestId("change-effort").click();
	await expect(page.getByText("Applies from your next message.")).toBeVisible();
});
