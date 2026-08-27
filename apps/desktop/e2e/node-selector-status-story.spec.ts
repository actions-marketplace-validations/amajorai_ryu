// Real-browser proof for the compact node selector's status treatment.

import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/node-selector-status-story.html";

test("keeps the node icon neutral and anchors status at its bottom right", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			pageErrors.push(message.text());
		}
	});
	await page.goto(STORY_URL);
	await page.waitForTimeout(1000);

	const trigger = page.getByRole("button", { name: /local/i });
	if ((await trigger.count()) === 0 && pageErrors.length > 0) {
		throw new Error(
			`Node selector story failed to mount: ${pageErrors.join(" | ")}`
		);
	}
	await expect(trigger).toBeVisible();

	const triggerIcon = trigger.locator('[data-slot="node-status-icon"]');
	const triggerDot = triggerIcon.locator('[data-slot="node-status-dot"]');
	await expect(triggerIcon).toHaveCount(1);
	await expect(triggerDot).toHaveCount(1);
	await expect(triggerDot).toHaveClass(/bg-success/);
	await expect(triggerDot).toHaveClass(/border-sidebar/);
	await expect(triggerIcon.locator("svg")).toHaveClass(
		/text-muted-foreground\/70/
	);
	await expect(triggerIcon.locator("svg")).not.toHaveClass(/text-success/);

	const iconBox = await triggerIcon.boundingBox();
	const dotBox = await triggerDot.boundingBox();
	expect(iconBox).not.toBeNull();
	expect(dotBox).not.toBeNull();
	if (iconBox && dotBox) {
		expect(dotBox.x).toBeGreaterThan(iconBox.x + iconBox.width / 2);
		expect(dotBox.y).toBeGreaterThan(iconBox.y + iconBox.height / 2);
	}

	await trigger.click();
	const activeRow = page.getByRole("menuitem", { name: /^Local/ });
	await expect(activeRow).toBeVisible();
	await expect(activeRow.locator('[data-slot="node-status-dot"]')).toHaveClass(
		/bg-success/
	);
	await expect(activeRow.locator('[data-slot="node-status-dot"]')).toHaveClass(
		/border-accent/
	);
	const shadowRow = page.getByRole("menuitem", { name: /^Shadow/ });
	await expect(shadowRow).toBeVisible();
	await expect(shadowRow.locator('span[class*="size-1.5"]')).toHaveClass(
		/bg-success/
	);
	await expect(page.getByRole("menuitem", { name: /Island/i })).toHaveCount(0);
	await activeRow.scrollIntoViewIfNeeded();

	await page.screenshot({
		fullPage: true,
		path: test.info().outputPath("node-selector-status-proof.png"),
	});
});
