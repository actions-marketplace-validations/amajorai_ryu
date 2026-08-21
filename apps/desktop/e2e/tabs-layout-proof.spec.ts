import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORAGE_KEY = "ryu.tabs.layout.proof";
const STORY_URL = "/tabs-layout-proof.html";

test("verifies overflow, menu controls, context reuse, and persisted layout", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page.evaluate(
		(storageKey) => localStorage.removeItem(storageKey),
		STORAGE_KEY
	);
	await page.reload();

	const moreTrigger = page.locator('[data-tabs-more-trigger="true"]');
	await expect(moreTrigger).toHaveAttribute("data-tabs-more-visible", "true");

	await moreTrigger.click();
	const commandInput = page.getByRole("combobox", { name: "Search tabs" });
	await expect(commandInput).toBeVisible();
	await expect(page.locator("[data-tabs-menu-key]")).toHaveCount(7);
	await commandInput.fill("Billing");
	await expect(
		page.locator("[data-tabs-menu-key]").filter({ hasText: "Billing" })
	).toBeVisible();
	await expect(
		page.locator("[data-tabs-menu-key]").filter({ hasText: "Overview" })
	).toBeHidden();
	await commandInput.fill("");

	await page.keyboard.press("Escape");
	const visibleTriggers = page.locator("[data-tabs-managed-trigger]");
	const firstVisibleTrigger = visibleTriggers.nth(1);
	const secondVisibleTrigger = visibleTriggers.nth(0);
	await expect(secondVisibleTrigger).toBeVisible();

	const initialOrder = await page.getByTestId("stored-order").innerText();
	const sourceBox = await firstVisibleTrigger.boundingBox();
	const targetBox = await secondVisibleTrigger.boundingBox();
	if (!(sourceBox && targetBox)) {
		throw new Error("Visible tab geometry was not available for drag proof");
	}
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2
	);
	await page.mouse.down();
	await page.waitForTimeout(100);
	await page.mouse.move(
		targetBox.x + targetBox.width * 0.25,
		targetBox.y + targetBox.height / 2,
		{ steps: 8 }
	);
	await expect(page.locator("[data-tabs-drop-indicator]")).toBeVisible();
	await page.mouse.up();
	await expect
		.poll(() => page.getByTestId("stored-order").innerText())
		.not.toBe(initialOrder);

	await secondVisibleTrigger.click({ button: "right" });
	const contextMenu = page.locator('[data-slot="context-menu-content"]');
	await expect(contextMenu).toBeVisible();
	await expect(
		contextMenu.getByRole("combobox", { name: "Search tabs" })
	).toBeVisible();
	await page.keyboard.press("Escape");

	await moreTrigger.click();
	await expect(commandInput).toBeVisible();
	await commandInput.fill("Overview");
	await expect(
		page.getByRole("button", { name: "More actions for Overview" })
	).toBeVisible();
	await page.getByRole("button", { name: "More actions for Overview" }).click();
	await page.getByRole("menuitem", { name: "Hide Overview" }).click();
	await page.keyboard.press("Escape");

	await expect(page.locator('[data-testid="hidden-keys"]')).not.toHaveText(
		"none"
	);
	await page.reload();
	await expect(page.locator('[data-testid="hidden-keys"]')).not.toHaveText(
		"none"
	);

	await page.locator('[data-tabs-more-trigger="true"]').click();
	await page.getByRole("button", { name: "Reset tabs" }).click();
	await expect(page.locator('[data-testid="hidden-keys"]')).toHaveText("none");
	await expect(page.locator('[data-testid="stored-order"]')).not.toHaveText(
		"none"
	);
});

test("verifies component-level scrolling controls when layout management is disabled", async ({
	page,
}, testInfo) => {
	await page.goto(STORY_URL);
	const proof = page.getByTestId("overflow-controls-proof");
	const list = proof.getByTestId("overflow-tabs-list");
	await expect(list).toHaveAttribute("data-tabs-overflow", "true");
	await expect(list).toHaveAttribute("data-edges", "end");
	await expect(list).toHaveCSS("overflow-y", "hidden");
	await expect(list.locator('[role="tab"]')).toHaveCount(7);

	const trigger = proof.getByRole("button", {
		name: "Open tab scroll controls",
	});
	await expect(trigger).toHaveCount(1);
	await expect(trigger).toHaveCSS("opacity", "0");
	await list.hover();

	const controls = page.locator('[data-slot="tabs-overflow-controls"]');
	await expect(controls).toBeVisible();
	const backward = controls.getByRole("button", { name: "Scroll tabs left" });
	const forward = controls.getByRole("button", { name: "Scroll tabs right" });
	await expect(backward).toBeDisabled();
	await expect(forward).toBeEnabled();
	await expect(controls).toHaveClass(/rounded-full/);
	await expect(backward).toHaveClass(/rounded-full/);
	await expect(forward).toHaveClass(/rounded-full/);
	await page.screenshot({
		path: testInfo.outputPath("tabs-layout-overflow-proof.png"),
	});

	const before = await list.evaluate((element) => element.scrollLeft);
	await forward.click();
	await expect
		.poll(() => list.evaluate((element) => element.scrollLeft), {
			timeout: 10_000,
		})
		.toBeGreaterThan(before);
	await expect(list).toHaveAttribute("data-edges", "both");
});
