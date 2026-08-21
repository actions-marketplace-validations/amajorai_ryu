import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/keyboard-shortcuts-search-proof.html";

test("keeps the large filter above an independently scrolling shortcut list", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const filter = page.getByTestId("keyboard-shortcuts-filter");
	const resetAll = page.getByTestId("keyboard-shortcuts-reset-all");
	const scroller = page.getByTestId("keyboard-shortcuts-scroll");
	await expect(filter).toBeVisible();
	await expect(filter).toHaveAttribute("placeholder", "Search");
	await expect(resetAll).toBeVisible();
	await expect(resetAll).toHaveText("Reset all to defaults");
	await expect(resetAll).toHaveClass(/bg-primary/);
	await expect(scroller).toBeVisible();

	const metrics = await filter.evaluate((element) => {
		const list = document.querySelector<HTMLElement>(
			'[data-testid="keyboard-shortcuts-scroll"]'
		);
		const reset = document.querySelector<HTMLElement>(
			'[data-testid="keyboard-shortcuts-reset-all"]'
		);
		if (!(list && reset)) {
			return null;
		}
		const filterBox = element.getBoundingClientRect();
		const listBox = list.getBoundingClientRect();
		const resetBox = reset.getBoundingClientRect();
		return {
			filterHeight: filterBox.height,
			hasLargeSize: element.classList.contains("h-10"),
			listTop: listBox.top,
			filterBottom: filterBox.bottom,
			resetTop: resetBox.top,
			hasOverflow: list.scrollHeight > list.clientHeight,
			isScrollFade: list.classList.contains("scroll-fade"),
		};
	});
	if (!metrics) {
		throw new Error("Keyboard shortcut layout did not render");
	}
	expect(metrics.filterHeight).toBeGreaterThanOrEqual(38);
	expect(metrics.hasLargeSize).toBe(true);
	expect(metrics.resetTop).toBeLessThan(metrics.listTop);
	expect(metrics.listTop).toBeGreaterThanOrEqual(metrics.filterBottom);
	expect(metrics.isScrollFade).toBe(true);
	expect(metrics.hasOverflow).toBe(true);

	await resetAll.click();
	const resetDialog = page.getByRole("heading", {
		name: "Reset all shortcuts to defaults?",
	});
	await expect(resetDialog).toBeVisible();
	await page
		.getByRole("button", { name: "Reset all to defaults", exact: true })
		.last()
		.click();
	await expect(resetDialog).not.toBeVisible();
	await expect(resetAll).toBeVisible();

	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expect(
		await scroller.evaluate((element) => element.scrollTop)
	).toBeGreaterThan(0);
	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-status",
		"pass"
	);

	await filter.fill("sidebar");
	await expect(page.getByText("Toggle Sidebar", { exact: true })).toBeVisible();
	await expect(page.getByText("New Chat", { exact: true })).not.toBeVisible();

	await filter.fill("no shortcut matches this phrase");
	await expect(resetAll).toBeVisible();
});
