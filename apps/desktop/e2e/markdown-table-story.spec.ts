// Real-browser proof for the shared Markdown table affordance. It checks the
// hover-only control and the large dialog, not just the component's JSX.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/markdown-table-story.html";

test("expands a wide markdown table into a scrollable dialog", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const table = page.locator(".an-md-table").first();
	await expect(table).toBeVisible();
	const inlineMetrics = await table.evaluate((element) => {
		const wrapper = element.parentElement;
		return {
			clientWidth: wrapper?.clientWidth ?? 0,
			scrollWidth: wrapper?.scrollWidth ?? 0,
		};
	});
	expect(inlineMetrics.scrollWidth).toBeGreaterThan(inlineMetrics.clientWidth);
	const expand = page.getByTestId("markdown-table-expand").first();
	await expect
		.poll(() => expand.evaluate((el) => getComputedStyle(el).opacity))
		.toBe("0");

	await table.hover();
	await expect
		.poll(() => expand.evaluate((el) => getComputedStyle(el).opacity))
		.toBe("1");
	await expand.click();

	const dialog = page.locator('[data-slot="dialog-content"]');
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Expanded markdown table");
	await expect(dialog).toContainText("Core");
	await expect(dialog.locator("table")).toHaveCount(1);

	const metrics = await dialog.locator("div.overflow-auto").evaluate((el) => ({
		clientWidth: el.clientWidth,
		scrollWidth: el.scrollWidth,
		clientHeight: el.clientHeight,
		scrollHeight: el.scrollHeight,
	}));
	expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
	expect(metrics.scrollHeight).toBeGreaterThan(0);
});
