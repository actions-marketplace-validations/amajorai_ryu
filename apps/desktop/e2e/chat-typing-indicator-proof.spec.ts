// Real-browser proof for the live chat typing indicator. The story mounts the
// production MessageList, then this spec checks the visual and accessible shape:
// a status bubble, no visible shimmer text, and exactly three animated dots.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-typing-indicator-proof.html";

test("live chat uses the traditional bubble-and-dots indicator", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const indicator = page.getByTestId("chat-typing-indicator");
	await expect(indicator).toBeVisible();
	await expect(indicator).toHaveAttribute("role", "status");
	await expect(indicator).toHaveAccessibleName("Assistant is thinking");
	await expect(indicator.getByTestId("chat-typing-dots")).toBeVisible();
	await expect(
		indicator.locator('[data-testid="chat-typing-dots"] > span > span > span')
	).toHaveCount(3);
	await expect(indicator.locator('[class*="shimmer"]')).toHaveCount(0);
	await expect(
		indicator.getByText("Assistant is thinking", { exact: true })
	).toHaveCount(0);
});
