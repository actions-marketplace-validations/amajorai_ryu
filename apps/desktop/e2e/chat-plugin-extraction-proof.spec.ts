import { expect, test } from "@playwright/test";

const STORY_URL = "/chat-plugin-extraction-proof.html";

test.describe.configure({ timeout: 120_000 });

test("renders the three chat plugin owners and main-chat context handoff", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("chat-plugin-proof")).toBeVisible();
	await expect(page.getByTestId("@ryu/side-chats-feature-row")).toContainText(
		"Enabled"
	);
	await expect(page.getByTestId("@ryu/reactions-feature-row")).toContainText(
		"Enabled"
	);
	await expect(page.getByTestId("@ryu/ghost-chats-feature-row")).toContainText(
		"Enabled"
	);

	const context = page.getByTestId("side-chat-context-proof");
	await expect(context).toContainText("main chat");
	await expect(page.getByTestId("side-chat-context-messages")).toContainText(
		"The latest answer is still streaming in this main chat."
	);
	await expect(page.getByTestId("side-chat-context-payload")).toContainText(
		'"role":"assistant"'
	);
});

test("proves the temporary-chat privacy toggle changes the host lifecycle", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const toggle = page.getByTestId("ghost-chat-toggle");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByTestId("ghost-chat-lifecycle")).toContainText("true");

	await toggle.click();

	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("ghost-chat-lifecycle")).toContainText("false");
	await expect(page.getByTestId("ghost-chat-lifecycle")).toContainText(
		"skipped"
	);
});

test("renders the real reaction message-action surface from its plugin action", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("reaction-proof")).toContainText(
		"reactions.picker"
	);
	await expect(
		page.getByTestId("reaction-proof").locator("button").first()
	).toBeVisible();
});
