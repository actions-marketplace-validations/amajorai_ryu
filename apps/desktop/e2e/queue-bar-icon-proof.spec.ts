import { expect, test } from "@playwright/test";

const STORY_URL = "/queue-bar-icon-proof.html";

test("uses the Lucide list-end icon for queued messages", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);

	await expect(
		page.getByText("Queued messages", { exact: true })
	).toBeVisible();
	const icon = page.locator("svg.lucide-list-end");
	await expect(icon).toHaveCount(1);
	await expect(icon).toBeVisible();

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("queue-bar-list-end-proof.png"),
	});
});
