import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("updates appearance preferences from the relevant right-click surfaces", async ({
	page,
}) => {
	await page.goto("/appearance-context-menu-proof.html");

	const tabSurface = page.getByTestId("tab-surface");
	await tabSurface.click({ button: "right" });
	const tabMenu = page.locator('[data-slot="context-menu-content"]');
	await expect(tabMenu).toBeVisible();
	await expect(tabMenu).toContainText("Show tabs as a dropdown");
	await expect(tabMenu).toContainText("Show tab search button");
	await expect(tabMenu).toContainText("Floating tab pills");
	await tabMenu
		.getByRole("menuitemcheckbox", { name: "Show tabs as a dropdown" })
		.click();
	await expect(page.getByTestId("tab-state")).toContainText("full strip");

	await tabSurface.click({ button: "right" });
	await tabMenu
		.getByRole("menuitemcheckbox", { name: "Show tab search button" })
		.click();
	await expect(page.getByTestId("tab-state")).toContainText("search hidden");

	await tabSurface.click({ button: "right" });
	await expect(
		tabMenu.getByRole("menuitemradio", { name: "Horizontal tabs" })
	).toBeVisible();
	await expect(
		tabMenu.getByRole("menuitemradio", { name: "Vertical tabs" })
	).toBeVisible();
	await expect(
		tabMenu.getByRole("menuitemradio", { name: "Scrollable tabs" })
	).toBeVisible();
	await expect(
		tabMenu.getByRole("menuitemradio", { name: "Infinite canvas" })
	).toBeVisible();
	await tabMenu.getByRole("menuitemradio", { name: "Scrollable tabs" }).click();
	await expect(page.getByTestId("tab-layout-state")).toContainText("scroll");
	await page.keyboard.press("Escape");

	await tabSurface.click({ button: "right" });
	await tabMenu.getByRole("menuitemradio", { name: "Infinite canvas" }).click();
	await expect(page.getByTestId("tab-layout-state")).toContainText("canvas");
	await page.keyboard.press("Escape");

	const sidebarSurface = page.getByTestId("sidebar-surface");
	await sidebarSurface.click({ button: "right" });
	const sidebarMenu = page.locator('[data-slot="context-menu-content"]');
	await expect(sidebarMenu).toBeVisible();
	await expect(sidebarMenu).toContainText("Group lists by date");
	await expect(sidebarMenu).toContainText("Show latest message / tool state");
	await expect(
		sidebarMenu.getByRole("menuitemradio", { name: "Infinite canvas" })
	).toBeVisible();
	await sidebarMenu
		.getByRole("menuitemcheckbox", { name: "Group lists by date" })
		.click();
	await expect(page.getByTestId("sidebar-state")).toContainText("date grouped");
});
