import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "reply-thread-proof.html";

function messageRow(page: Page, text: string) {
	return page
		.locator('[data-slot="message-scroller-item"]')
		.filter({ hasText: text })
		.first();
}

test("suggests a focused thread for a long reply chain", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("reply-thread-proof")).toBeVisible();

	const row = messageRow(page, "The original product decision");
	await row.getByText("The original product decision", { exact: true }).hover();
	const reply = row
		.locator('[data-slot="message-toolbar"]')
		.first()
		.getByRole("button", { name: "Reply to message" });
	await expect(reply).toBeVisible();
	await reply.click();

	await expect(
		page.locator('[data-slot="composer-quote-preview"]')
	).toContainText("The original product decision");
	await expect(
		page.getByText("Long reply chain", { exact: true })
	).toBeVisible();
	await expect(
		page.getByText(
			"This reply is part of a 3-turn chain. Keep the context in a focused thread.",
			{ exact: true }
		)
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Create thread" })
	).toBeVisible();

	await page.screenshot({
		path:
			process.env.RYU_PROOF_SCREENSHOT ??
			testInfo.outputPath("reply-thread-proof.png"),
		fullPage: true,
	});

	await page.getByRole("button", { name: "Create thread" }).click();
	await expect(page.getByTestId("thread-created")).toBeVisible();
});
