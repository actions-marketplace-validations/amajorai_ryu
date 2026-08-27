import { expect, test } from "@playwright/test";

const STORY_URL = "/learning-feedback-proof.html";

test("renders and toggles the Learning plugin feedback action", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("learning-feedback-proof")).toBeVisible();
	await expect(page.getByTestId("feedback-contract")).toContainText(
		"learning.recordFeedback"
	);
	const good = page.getByRole("button", { name: "Good response" });
	const bad = page.getByRole("button", { name: "Bad response" });
	await expect(good).toHaveAttribute("aria-pressed", "false");
	await expect(bad).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByTestId("feedback-status")).toContainText(
		"No response rating selected"
	);

	await good.click();
	await expect(good).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("feedback-status")).toContainText(
		"Good response selected"
	);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("learning-feedback-proof.png"),
	});

	await good.click();
	await expect(good).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByTestId("feedback-status")).toContainText(
		"No response rating selected"
	);

	await bad.click();
	await expect(bad).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("feedback-status")).toContainText(
		"Bad response selected"
	);
});
