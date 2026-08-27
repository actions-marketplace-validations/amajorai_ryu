import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/reconnect-retry-proof.html";

test("reconnect retry banner shows loss, recovery, and bounded failure states", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const proof = page.getByTestId("reconnect-retry-proof");
	const banner = page.getByTestId("reconnect-retry-status");
	await expect(proof).toHaveAttribute("data-harness-ready", "1");
	await expect(banner).toContainText("Connection restored");
	await expect(banner).toContainText("1 chat is running again.");

	await page.getByRole("button", { name: "Simulate connection loss" }).click();
	await expect(banner).toContainText("Connection lost");
	await expect(banner).toContainText("1 active chat is queued");

	await page.getByRole("button", { name: "Connection returns" }).click();
	await expect(banner).toContainText("Starting one retry for 1 chat");

	await page.getByRole("button", { name: "Retry needs attention" }).click();
	await expect(banner).toContainText("Reconnect retry needs attention");
});
