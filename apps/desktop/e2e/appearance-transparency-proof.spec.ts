import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("keeps sidebar and whole-window transparency independent", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});

	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto("/appearance-transparency-proof.html");

	const html = page.locator("html");
	const root = page.getByTestId("window-root");
	const sidebar = page.getByTestId("sidebar-surface");
	const windowSurface = page.getByTestId("window-surface");
	const sidebarSwitch = page.getByRole("switch", {
		name: "Transparent sidebar",
	});
	const windowSwitch = page.getByRole("switch", {
		name: "Transparent window",
	});

	await expect(sidebarSwitch).not.toBeChecked();
	await expect(windowSwitch).not.toBeChecked();
	await expect(html).not.toHaveAttribute("data-ryu-sidebar-transparency");
	await expect(html).not.toHaveAttribute("data-ryu-window-transparency");

	await sidebarSwitch.click();
	await expect(sidebarSwitch).toBeChecked();
	await expect(html).toHaveAttribute("data-ryu-sidebar-transparency", "true");
	await expect(html).not.toHaveAttribute("data-ryu-window-transparency");
	await expect
		.poll(() =>
			sidebar.evaluate((element) => getComputedStyle(element).backdropFilter)
		)
		.toContain("blur(24px)");
	await expect(page.getByTestId("surface-state")).toContainText(
		"Sidebar: glass on"
	);
	await expect(page.getByTestId("surface-state")).toContainText(
		"Window: opaque"
	);

	await windowSwitch.click();
	await expect(windowSwitch).toBeChecked();
	await expect(html).toHaveAttribute("data-ryu-sidebar-transparency", "true");
	await expect(html).toHaveAttribute("data-ryu-window-transparency", "true");
	await expect
		.poll(() =>
			root.evaluate((element) => getComputedStyle(element).backgroundColor)
		)
		.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
	await expect
		.poll(() =>
			windowSurface.evaluate(
				(element) => getComputedStyle(element).backdropFilter
			)
		)
		.toContain("blur(28px)");

	// Turning off the sidebar leaves the whole-window choice untouched.
	await sidebarSwitch.click();
	await expect(sidebarSwitch).not.toBeChecked();
	await expect(windowSwitch).toBeChecked();
	await expect(html).not.toHaveAttribute("data-ryu-sidebar-transparency");
	await expect(html).toHaveAttribute("data-ryu-window-transparency", "true");

	// And turning off the window leaves the sidebar choice untouched (both are
	// now off, which proves each switch owns its own persisted key).
	await windowSwitch.click();
	await expect(windowSwitch).not.toBeChecked();
	await expect(html).not.toHaveAttribute("data-ryu-sidebar-transparency");
	await expect(html).not.toHaveAttribute("data-ryu-window-transparency");
	await expect(
		page.evaluate(() => ({
			sidebar: localStorage.getItem("ryu:sidebar-transparency"),
			window: localStorage.getItem("ryu:window-transparency"),
		}))
	).resolves.toEqual({ sidebar: "false", window: "false" });

	await sidebarSwitch.click();
	await windowSwitch.click();
	await page.screenshot({
		path: testInfo.outputPath("appearance-transparency-proof.png"),
		fullPage: true,
	});

	expect(browserErrors, `browser errors: ${browserErrors.join(" | ")}`).toEqual(
		[]
	);
});
