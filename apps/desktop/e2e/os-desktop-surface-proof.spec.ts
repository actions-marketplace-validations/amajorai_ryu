import { expect, test } from "@playwright/test";

const PROOF_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/26/01a03e3f-3cef-78b0-ba6f-281d987dc998/ryu-os-mission-control-proof.png";
const DOCK_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/26/01a03e3f-3cef-78b0-ba6f-281d987dc998/ryu-os-dock-icons-proof.png";
const MENUBAR_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/26/01a03e3f-3cef-78b0-ba6f-281d987dc998/ryu-os-menubar-proof.png";
const OS_DOCK_ICON_COUNT = 7;

test("opens Apps as live windows from the Ryu OS dock and Mission Control", async ({
	page,
}) => {
	await page.setViewportSize({ height: 900, width: 1440 });
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto("/os-desktop-surface-proof.html");
	await page.waitForTimeout(2500);

	await expect(page.getByTestId("ryu-os-desktop")).toBeVisible();
	await expect(page.getByTestId("ryu-os-dock")).toBeVisible();
	await expect(page.getByTestId("ryu-os-menubar")).toHaveClass(
		/\bbg-transparent\b/
	);
	await expect(page.locator('[data-tauri-drag-region="true"]')).not.toHaveClass(
		/\bborder-b\b/
	);
	await expect(page.locator('[data-slot="menubar-trigger"]')).toHaveCount(3);
	await expect(
		page.locator('[data-slot="menubar-trigger"]').first()
	).toHaveClass(/\bbg-transparent\b/);
	await expect(page.getByTestId("os-dock-mission-control")).toBeVisible();
	const dockItems = page.locator('[data-testid^="os-dock-"]');
	for (let index = 0; index < OS_DOCK_ICON_COUNT; index++) {
		const itemBox = await dockItems.nth(index).boundingBox();
		const iconBox = await dockItems
			.nth(index)
			.locator(":scope > div")
			.first()
			.boundingBox();
		expect(itemBox).not.toBeNull();
		expect(iconBox).not.toBeNull();
		if (!(itemBox && iconBox)) {
			continue;
		}
		expect(Math.abs(itemBox.width - itemBox.height)).toBeLessThan(1);
		expect(
			Math.abs(itemBox.x + itemBox.width / 2 - (iconBox.x + iconBox.width / 2))
		).toBeLessThan(1);
		expect(
			Math.abs(
				itemBox.y + itemBox.height / 2 - (iconBox.y + iconBox.height / 2)
			)
		).toBeLessThan(1);
	}
	await expect(
		page.locator('[data-testid^="os-dock-"] [style*="mask-image"]')
	).toHaveCount(OS_DOCK_ICON_COUNT);
	await expect(page.getByTestId("os-window-window-chat")).toBeVisible();
	await expect(page.getByTestId("os-window-window-spaces")).toHaveCount(1);
	const chatWindow = page.getByTestId("os-window-window-chat");
	const spacesWindow = page.getByTestId("os-window-window-spaces");
	await expect(
		page.getByTestId("os-window-window-chat-minimize")
	).toBeVisible();
	await expect(
		page.getByTestId("os-window-window-chat-maximize")
	).toBeVisible();
	await expect(page.getByTestId("os-window-window-chat-close")).toBeVisible();
	await page.getByTestId("os-window-window-chat-maximize").click();
	await expect(chatWindow).toHaveAttribute("data-maximized", "true");
	await expect(
		page.getByRole("button", { name: "Restore Chat" })
	).toBeVisible();
	await page.getByTestId("os-window-window-chat-maximize").click();
	await expect(chatWindow).toHaveAttribute("data-maximized", "false");
	await page.getByTestId("os-window-window-chat-minimize").click();
	await expect(chatWindow).toBeHidden();
	await expect(spacesWindow).toBeVisible();
	await page.getByTestId("os-dock-mission-control").click();
	await expect(
		page.getByTestId("mission-control-window-window-chat")
	).toBeVisible();
	await page.getByTestId("mission-control-window-window-chat").click();
	await expect(chatWindow).toBeVisible();
	await expect(spacesWindow).toBeHidden();
	const missionControlDockItem = page.getByTestId("os-dock-mission-control");
	const initialDockWidth = Number.parseFloat(
		(await missionControlDockItem.getAttribute("style"))?.match(
			/width:\s*([\d.]+)px/
		)?.[1] ?? "0"
	);
	await missionControlDockItem.hover();
	await expect
		.poll(async () =>
			Number.parseFloat(
				(await missionControlDockItem.getAttribute("style"))?.match(
					/width:\s*([\d.]+)px/
				)?.[1] ?? "0"
			)
		)
		.toBeGreaterThan(initialDockWidth);
	await page.screenshot({ path: DOCK_SCREENSHOT, fullPage: true });
	await page.mouse.move(20, 120);
	await page.screenshot({
		path: "/Users/jiawei/.codex/visualizations/2026/08/26/01a03e3f-3cef-78b0-ba6f-281d987dc998/ryu-os-desktop-proof.png",
		fullPage: true,
	});
	const wallpaper = page.locator("[data-wallpaper-id]");
	const initialWallpaper = await wallpaper.getAttribute("data-wallpaper-id");
	await page.getByTestId("os-wallpaper-shuffle").click();
	await expect(wallpaper).not.toHaveAttribute(
		"data-wallpaper-id",
		initialWallpaper ?? ""
	);

	await page.getByTestId("os-dock-mission-control").click();
	await expect(page.getByText("Mission Control").last()).toBeVisible();
	await expect(page.getByTestId("mission-control-app-tools")).toBeVisible();
	await expect(
		page.getByTestId("mission-control-window-window-spaces")
	).toBeVisible();
	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });

	await page.keyboard.press("Escape");
	await page.getByRole("menuitem", { name: "Window" }).click();
	await expect(page.getByTestId("mission-control-trigger")).toBeVisible();
	await page.screenshot({ path: MENUBAR_SCREENSHOT, fullPage: true });
	await page.getByTestId("mission-control-trigger").click();
	await expect(page.getByText("Mission Control").last()).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByTestId("os-dock-mission-control").click();
	await expect(page.getByTestId("mission-control-app-tools")).toBeVisible();
	await page.getByTestId("mission-control-app-tools").click();
	await expect(page.getByTestId("os-window-window-tools")).toBeVisible();
	await expect(page.getByTestId("os-window-window-chat")).toBeHidden();

	await page.screenshot({
		path: "/Users/jiawei/.codex/visualizations/2026/08/26/01a03e3f-3cef-78b0-ba6f-281d987dc998/ryu-os-tools-window-proof.png",
		fullPage: true,
	});
	await page.getByTestId("os-window-window-tools-close").click();
	await expect(page.getByTestId("os-window-window-tools")).toBeHidden();
	await expect(pageErrors).toEqual([]);
});
