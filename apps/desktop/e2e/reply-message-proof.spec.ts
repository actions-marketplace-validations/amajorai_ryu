import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "reply-message-proof.html";

function messageRow(page: Page, text: string) {
	return page
		.locator('[data-slot="message-scroller-item"]')
		.filter({ hasText: text })
		.first();
}

async function clickReply(page: Page, text: string, toolbarIndex: number) {
	const row = messageRow(page, text);
	await row.getByText(text, { exact: true }).hover();
	const toolbar = row
		.locator('[data-slot="message-toolbar"]')
		.nth(toolbarIndex);
	const reply = toolbar.getByRole("button", { name: "Reply to message" });
	await expect(reply).toBeVisible();
	await reply.click();
	await expect(
		page.locator('[data-slot="composer-quote-preview"]')
	).toContainText(text);
}

test("adds the reply action to all message authors and opens the quote composer", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("reply-message-proof")).toBeVisible();

	const replyButtons = page.getByRole("button", { name: "Reply to message" });
	await expect(replyButtons).toHaveCount(3);

	// The first turn contains the user's toolbar and the assistant toolbar.
	await clickReply(page, "My own message to revisit", 0);
	await page.getByRole("button", { name: "Remove quote" }).click();

	await clickReply(
		page,
		"The agent's answer is ready to quote in a follow-up.",
		1
	);
	await page.getByRole("button", { name: "Remove quote" }).click();

	await clickReply(page, "Alex's message in the shared chat", 0);
	await expect(
		page.getByRole("button", { name: "Remove quote" })
	).toBeVisible();

	await page.screenshot({
		path:
			process.env.RYU_PROOF_SCREENSHOT ??
			testInfo.outputPath("reply-message-proof.png"),
		fullPage: true,
	});
	await expect(page.getByTestId("reply-message-proof")).toContainText(
		"Reply without selecting text"
	);
});
