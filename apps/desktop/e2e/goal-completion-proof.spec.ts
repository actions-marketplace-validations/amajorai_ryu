import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("shows the achieved goal status and completion time on the final turn", async ({
	page,
}) => {
	await page.goto("/goal-completion-proof.html");

	const completion = page.getByTestId("goal-completion");
	await expect(completion).toBeVisible();
	await expect(completion).toContainText("Goal achieved in 4h 2s");
	await expect(page.getByTestId("goal-completion-time")).toHaveText(
		/\d{1,2}:\d{2}/
	);
	await expect(
		page.locator('[data-slot="message-toolbar"] [data-slot="goal-completion"]')
	).toHaveCount(1);

	await page.screenshot({
		fullPage: true,
		path: "test-results/goal-completion-proof.png",
	});
});
