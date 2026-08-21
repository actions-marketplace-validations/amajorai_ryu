// Real-browser proof for the chat preview rail overflow behavior
// (`e2e/harness/chat-preview-rail-story.{html,tsx}`).

import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/chat-preview-rail-story.html";
const EXPECTED_MESSAGE_COUNT = "56";
const EXPECTED_NAVIGATION_COUNT = 28;

async function openStory(page: Page) {
	await page.goto(STORY_URL);
	await expect(page.getByTestId("story-state")).toHaveAttribute(
		"data-message-count",
		EXPECTED_MESSAGE_COUNT,
		{ timeout: 60_000 }
	);
}

function collapsedRail(page: Page) {
	return page.locator('[data-slot="message-navigation-collapsed-rail"]');
}

function navigationPopover(page: Page) {
	return page.locator('[data-message-navigation-popover="true"]');
}

test("collapses a long message rail into a compact trigger", async ({
	page,
}) => {
	await openStory(page);

	const trigger = collapsedRail(page);
	await expect(trigger).toBeVisible();
	await expect(trigger).toHaveAttribute(
		"data-count",
		String(EXPECTED_NAVIGATION_COUNT)
	);
	await expect(page.locator('[data-slot="preview-rail-item"]')).toHaveCount(0);

	const viewportHeight = await page
		.locator('[data-slot="message-scroller-viewport"]')
		.evaluate((element) => element.clientHeight);
	const triggerBox = await trigger.boundingBox();
	expect(triggerBox).not.toBeNull();
	if (triggerBox) {
		expect(triggerBox.height).toBeLessThan(viewportHeight * 0.3);
	}
});

test("opens every message in one bounded scrollable popover", async ({
	page,
}) => {
	await openStory(page);
	await collapsedRail(page).click();

	const popover = navigationPopover(page);
	await expect(popover).toBeVisible();
	const items = popover.locator('[data-slot="message-navigation-item"]');
	await expect(items).toHaveCount(EXPECTED_NAVIGATION_COUNT);

	const metrics = await popover
		.locator('[data-slot="message-navigation-list"]')
		.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				clientHeight: element.clientHeight,
				maxHeight: style.maxHeight,
				overflowY: style.overflowY,
				scrollHeight: element.scrollHeight,
			};
		});

	expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
	expect(metrics.overflowY).toBe("auto");
	expect(metrics.maxHeight).not.toBe("none");
});

test("selecting a popover message closes it and updates the active jump target", async ({
	page,
}) => {
	await openStory(page);
	const trigger = collapsedRail(page);
	await trigger.click();

	const target = navigationPopover(page)
		.locator('[data-slot="message-navigation-item"]')
		.nth(12);
	const targetId = await target.getAttribute("data-message-id");
	expect(targetId).not.toBeNull();
	await target.click();

	await expect(navigationPopover(page)).toHaveCount(0);
	if (targetId) {
		await expect(trigger).toHaveAttribute("data-active-message-id", targetId);
	}
});
