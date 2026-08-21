// Browser proof for the real AgentChat composer and the Drafts persistence
// contract. The page uses a hermetic durable adapter, while production writes go
// through the same `draftIdFor` keys into the Drafts sidecar.

import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/composer-draft-persistence-proof.html";
const STORAGE_KEY = "ryu-proof-composer-drafts";

async function reset(page: Page) {
	await page.goto(STORY_URL);
	await page.evaluate(
		(key: string) => localStorage.removeItem(key),
		STORAGE_KEY
	);
	await page.reload();
}

test("keeps each conversation textarea across tabs and a cold reopen", async ({
	page,
}) => {
	await reset(page);

	const tabA = page.getByTestId("composer-tab-conversation-a");
	const tabB = page.getByTestId("composer-tab-conversation-b");
	await tabA.locator("textarea").fill("Draft belonging to conversation A");
	await page.getByRole("tab", { name: "Conversation B" }).click();
	await tabB.locator("textarea").fill("Draft belonging to conversation B");
	await page.getByRole("tab", { name: "Conversation A" }).click();
	await expect(tabA.locator("textarea")).toHaveValue(
		"Draft belonging to conversation A"
	);
	await page.getByRole("tab", { name: "Conversation B" }).click();
	await expect(tabB.locator("textarea")).toHaveValue(
		"Draft belonging to conversation B"
	);
	await expect(page.getByTestId("conversation-row-count")).toHaveText("2");

	await page
		.getByRole("button", { name: "Simulate app close + reopen" })
		.click();
	await page.getByRole("tab", { name: "Conversation A" }).click();
	await expect(tabA.locator("textarea")).toHaveValue(
		"Draft belonging to conversation A"
	);
	await page.getByRole("tab", { name: "Conversation B" }).click();
	await expect(tabB.locator("textarea")).toHaveValue(
		"Draft belonging to conversation B"
	);
});

test("stores only the latest unsent new-chat prompt", async ({ page }) => {
	await reset(page);

	const first = page.getByTestId("composer-tab-launchpad-one");
	const second = page.getByTestId("composer-tab-launchpad-two");
	await page.getByRole("tab", { name: "New chat 1" }).click();
	await first.locator("textarea").fill("Older new-chat prompt");
	await page.getByRole("tab", { name: "New chat 2" }).click();
	await second.locator("textarea").fill("Latest new-chat prompt");
	await expect(page.getByTestId("durable-row-count")).toHaveText("1");
	await expect(page.getByTestId("latest-launchpad")).toHaveText(
		"Latest new-chat prompt"
	);

	await page
		.getByRole("button", { name: "Simulate app close + reopen" })
		.click();
	await page.getByRole("tab", { name: "New chat 1" }).click();
	await expect(first.locator("textarea")).toHaveValue("Latest new-chat prompt");
	await page.getByRole("tab", { name: "New chat 2" }).click();
	await expect(second.locator("textarea")).toHaveValue(
		"Latest new-chat prompt"
	);
});

test("clearing a textarea removes its durable row", async ({ page }) => {
	await reset(page);

	const tabA = page.getByTestId("composer-tab-conversation-a");
	await tabA.locator("textarea").fill("A draft that will be cleared");
	await tabA.locator("textarea").fill("");
	await expect(page.getByTestId("durable-row-count")).toHaveText("0");
	await page
		.getByRole("button", { name: "Simulate app close + reopen" })
		.click();
	await expect(tabA.locator("textarea")).toHaveValue("");
});
