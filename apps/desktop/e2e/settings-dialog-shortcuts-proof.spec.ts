import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

const STORY_URL = "/settings-dialog-shortcuts-proof.html";

test("opens both dialogs from platform-aware shortcuts and hides them on mobile", async ({
	page,
}, testInfo) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.goto(STORY_URL);
	await expect(page.locator("body")).toHaveAttribute(
		"data-hotkeys-ready",
		"true"
	);

	await page.keyboard.down("Control");
	await page.keyboard.press(".");
	await page.keyboard.up("Control");
	await expect(page.getByTestId("shortcut-last-action")).toHaveText(
		"settings.open"
	);
	const settingsDialog = page.locator('[data-slot="dialog-content"]');
	await expect(settingsDialog).toBeVisible();
	await expect(
		settingsDialog.getByRole("heading", { name: "General", exact: true })
	).toBeVisible();
	await settingsDialog.getByText("Keyboard Shortcuts", { exact: true }).click();
	await expect(
		settingsDialog.getByText("Open Settings", { exact: true })
	).toBeVisible();
	await expect(
		settingsDialog.getByText("Open Gateway Settings", { exact: true })
	).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(settingsDialog).not.toBeVisible();

	await page.keyboard.down("Control");
	await page.keyboard.press(",");
	await page.keyboard.up("Control");
	await expect(page.getByTestId("shortcut-last-action")).toHaveText(
		"gateway.open"
	);
	const gatewayDialog = page.locator('[data-slot="dialog-content"]');
	await expect(gatewayDialog).toBeVisible();
	await expect(
		gatewayDialog.getByRole("heading", { name: "Overview", exact: true })
	).toBeVisible();

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("settings-dialog-shortcuts-proof.png"),
	});

	await page.keyboard.press("Escape");
	await page.getByTestId("switch-mobile").click();
	await page.getByTestId("open-mobile-keyboard").click();
	await expect(page.getByTestId("proof-surface")).toHaveText("mobile");
	await expect(
		page.getByRole("heading", { name: "General", exact: true })
	).toBeVisible();
	await expect(
		page.getByText("Keyboard Shortcuts", { exact: true })
	).not.toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open Keyboard Shortcuts" })
	).not.toBeVisible();

	expect(browserErrors, `browser errors: ${browserErrors.join(" | ")}`).toEqual(
		[]
	);
});
