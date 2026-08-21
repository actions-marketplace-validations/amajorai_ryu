import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("toggles the shared popup backdrop across active desktop surfaces", async ({
	page,
}, testInfo) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message)
	);
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});

	await page.setViewportSize({ height: 900, width: 1440 });
	await page.goto("/popup-overlay-blur-proof.html");

	const toggle = page.getByRole("switch", {
		name: "Blur popup backgrounds",
	});
	await expect(toggle).not.toBeChecked();
	await expect(page.getByTestId("popup-overlay-state")).toHaveText(
		"Popup overlay blur: disabled"
	);
	await expect(page.locator("html")).not.toHaveAttribute(
		"data-popup-overlay-blur"
	);

	await page.getByTestId("dropdown-trigger").click();
	const dropdownOverlay = page.locator('[data-slot="dropdown-menu-overlay"]');
	await expect(dropdownOverlay).toHaveCSS("display", "none");
	await page.keyboard.press("Escape");

	await toggle.click();
	await expect(toggle).toBeChecked();
	await expect(page.getByTestId("popup-overlay-state")).toHaveText(
		"Popup overlay blur: enabled"
	);
	await expect(page.locator("html")).toHaveAttribute(
		"data-popup-overlay-blur",
		"on"
	);

	await page.getByTestId("dropdown-trigger").click();
	await expect(dropdownOverlay).toBeVisible();
	const overlayMetrics = await dropdownOverlay.evaluate((element) => {
		const styles = getComputedStyle(element);
		return {
			backdropFilter: styles.backdropFilter,
			backgroundColor: styles.backgroundColor,
			display: styles.display,
			position: styles.position,
			zIndex: styles.zIndex,
		};
	});
	expect(overlayMetrics).toMatchObject({
		backdropFilter: "blur(8px)",
		backgroundColor: "rgba(0, 0, 0, 0.18)",
		display: "block",
		position: "fixed",
		zIndex: "40",
	});
	await expect(page.getByTestId("dropdown-content")).toBeVisible();
	await page
		.locator(".ryu-popup-overlay")
		.click({ position: { x: 16, y: 16 } });
	await expect(page.getByTestId("dropdown-content")).toBeHidden();

	await page.getByRole("combobox", { name: "Select workspace" }).click();
	await expect(page.locator('[data-slot="select-overlay"]')).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByTestId("context-surface").click({ button: "right" });
	await expect(
		page.locator('[data-slot="context-menu-overlay"]')
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByTestId("popover-trigger").click();
	await expect(page.locator('[data-slot="popover-overlay"]')).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(
		page.locator('[data-slot="navigation-menu-overlay"]')
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByTestId("dropdown-trigger").click();
	await expect(page.getByTestId("dropdown-content")).toBeVisible();
	await page.waitForTimeout(500);

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("popup-overlay-blur-proof.png"),
	});

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});
