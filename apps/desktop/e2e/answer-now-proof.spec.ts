import { expect, test } from "@playwright/test";

const STORY_URL = "/answer-now-proof.html";

test("shows and activates the shared Answer now affordance", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);
	const thinkingBlock = page.getByRole("status", {
		name: "Assistant is thinking",
	});
	const answerNow = page.getByRole("button", { name: "Answer now" });
	await expect(thinkingBlock).toBeVisible();
	await expect(answerNow).toBeVisible();
	await expect(answerNow).toBeEnabled();
	const thinkingBox = await thinkingBlock.boundingBox();
	const answerNowBox = await answerNow.boundingBox();
	expect(thinkingBox).not.toBeNull();
	expect(answerNowBox).not.toBeNull();
	if (thinkingBox && answerNowBox) {
		expect(answerNowBox.y).toBeGreaterThanOrEqual(
			thinkingBox.y + thinkingBox.height
		);
	}
	await expect(page.getByTestId("proof-status")).toContainText(
		"Reasoning in progress"
	);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("answer-now-proof.png"),
	});

	await answerNow.click();
	await expect(
		page.getByRole("button", { name: "Finishing answer" })
	).toBeVisible();
	await expect(page.getByTestId("proof-status")).toContainText(
		"Answer now accepted"
	);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("answer-now-after-click-proof.png"),
	});
});
