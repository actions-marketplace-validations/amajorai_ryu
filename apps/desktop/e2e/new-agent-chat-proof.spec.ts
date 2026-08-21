import { expect, test } from "@playwright/test";

const STORY_URL = "/new-agent-chat-proof.html";

test("manual agent creation opens a selected chat and sends its intro request", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto(STORY_URL, { waitUntil: "domcontentloaded" });
	await expect(page.getByTestId("created-chat")).toHaveCount(0);
	await page.getByRole("button", { name: "Create agent" }).click();

	const chat = page.getByTestId("created-chat");
	await expect(chat).toBeVisible();
	await expect(chat.getByTestId("created-agent")).toHaveText("Orbit");
	await expect(chat.getByTestId("chat-tab")).toHaveText("Orbit chat");
	await expect(chat.getByTestId("chat-route")).toHaveText("/chat");
	await expect(chat.getByTestId("chat-agent-id")).toHaveText("proof-agent-7");
	await expect(chat.getByTestId("chat-auto-send")).toHaveText(
		"welcome request sent"
	);
	await expect(chat.getByTestId("welcome-request")).toContainText(
		"Introduce yourself to me as Orbit"
	);
	await expect(chat.getByTestId("agent-introduction")).toContainText(
		"Hi — I’m Orbit"
	);
	await expect(chat.getByTestId("agent-introduction")).toContainText(
		"What would you like to work on first?"
	);
	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");

	expect(browserErrors).toEqual([]);
	await page.screenshot({
		fullPage: true,
		path: "test-results/new-agent-chat-proof.png",
	});
});
