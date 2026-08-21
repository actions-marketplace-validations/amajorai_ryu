// Real-browser proof for goal creation and editing in the transcript. The page
// mounts the production AgentChat and MessageList, not a test-only annotation.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/goal-message-proof.html";

test("creating and editing a goal render annotated user messages", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("goal-message-count")).toHaveText(
		"Goal messages: 0"
	);
	await expect(page.getByTestId("goal-message-annotation")).toHaveCount(0);

	const createdGoal = "Ship the feature and verify it in the browser.";
	await page.getByTestId("goal-input").fill(createdGoal);
	await page.getByTestId("create-goal").click();
	await expect(page.getByTestId("goal-message-count")).toHaveText(
		"Goal messages: 1"
	);
	await expect(page.getByTestId("goal-message-annotation")).toHaveCount(1);
	await expect(
		page.locator('[data-testid="user-message-bubble"]').filter({
			hasText: createdGoal,
		})
	).toBeVisible();

	const editedGoal = "Ship the feature, verify it, and document the result.";
	await page.getByTestId("goal-input").fill(editedGoal);
	await page.getByTestId("edit-goal").click();
	await expect(page.getByTestId("goal-message-count")).toHaveText(
		"Goal messages: 2"
	);
	await expect(page.getByTestId("goal-message-annotation")).toHaveCount(2);
	await expect(
		page.locator('[data-testid="user-message-bubble"]').filter({
			hasText: editedGoal,
		})
	).toBeVisible();
});
