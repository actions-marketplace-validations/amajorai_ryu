// Real-browser spec for the interface-mode story (`e2e/harness/
// interface-level-story.{html,tsx}`), which mounts the REAL
// `InterfaceLevelMenuItem` inside a REAL account-shaped dropdown.
//
// The contract under test:
//   • one binary switch between Ryu Work and Code, with Ryu Work as the default
//     an untouched install lands on;
//   • Code uses the Google gradient animation shared with decosmicweb;
//   • clicking the switch keeps the account menu open and writes the prefs it implies
//     (hidden compact detail at Ryu Work, full detail and run stats in Code).

import { expect, type Page, test } from "@playwright/test";

// Cold Vite compiles the dropdown + shared UI module graph on first navigation.
test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/interface-level-story.html";

async function openModePicker(page: Page) {
	await page.goto(STORY_URL);
	const trigger = page.getByRole("button", { name: "Account" });
	await expect(trigger).toBeVisible();
	await trigger.click();
	await expect(
		page.getByRole("switch", { name: "Interface mode" })
	).toBeVisible();
	await expect(page.getByRole("menu")).toHaveCount(1);
}

test("the control is a binary switch and starts in Ryu Work", async ({
	page,
}) => {
	await openModePicker(page);
	const toggle = page.getByRole("switch", { name: "Interface mode" });
	const firstMenuItem = page.getByRole("menuitem").first();
	await expect(firstMenuItem).toContainText("Ryu Work");
	await expect(firstMenuItem.locator("svg")).toHaveCount(0);
	await expect(page.getByRole("slider")).toHaveCount(0);
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(
		page.getByText("Ryu Work", { exact: true }).first()
	).toBeVisible();
	await expect(page.getByText("Code", { exact: true }).first()).toBeVisible();
});

test("clicking the switch moves between Ryu Work and Code", async ({
	page,
}) => {
	await openModePicker(page);
	const toggle = page.getByRole("switch", { name: "Interface mode" });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("expert");
	await expect(toggle).toBeVisible();

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("simple");
});

test("the inline switch is keyboard-operable without closing the account menu", async ({
	page,
}) => {
	await openModePicker(page);
	const toggle = page.getByRole("switch", { name: "Interface mode" });

	await toggle.focus();
	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.getByRole("menu")).toHaveCount(1);

	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("switching modes writes the prefs each mode implies", async ({ page }) => {
	await openModePicker(page);
	const toggle = page.getByRole("switch", { name: "Interface mode" });
	await page.evaluate(() =>
		localStorage.setItem("ryu:sidebar-mode", "sections")
	);

	// Code: the full transcript, commands expanded, run stats on.
	await toggle.click();
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("expert");
	await expect(page.getByTestId("ryu:hide-tool-detail")).toHaveText("false");
	await expect(page.getByTestId("ryu:expand-commands")).toHaveText("true");
	await expect(page.getByTestId("ryu:inference-stats")).toHaveText("true");
	await expect(page.getByTestId("ryu:sidebar-mode")).toHaveText("sections");

	// Back to Ryu Work: nothing expanded, no tool detail at all, stats back off.
	await toggle.click();
	await expect(page.getByTestId("ryu:interface-level")).toHaveText("simple");
	await expect(page.getByTestId("ryu:hide-tool-detail")).toHaveText("true");
	await expect(page.getByTestId("ryu:expand-commands")).toHaveText("false");
	await expect(page.getByTestId("ryu:inference-stats")).toHaveText("false");
	await expect(page.getByTestId("ryu:sidebar-mode")).toHaveText("agent");
});

test("Code uses the animated Google gradient", async ({ page }) => {
	await openModePicker(page);
	const toggle = page.getByRole("switch", { name: "Interface mode" });
	await toggle.click();

	const styles = await toggle.evaluate((element) => {
		const computed = getComputedStyle(element);
		return {
			animationDuration: computed.animationDuration,
			animationName: computed.animationName,
			backgroundImage: computed.backgroundImage,
			backgroundSize: computed.backgroundSize,
		};
	});
	await expect(styles.backgroundImage).toContain("linear-gradient");
	await expect(styles.backgroundImage).toMatch(/#db4437|rgb\(219, 68, 55\)/i);
	await expect(styles.backgroundImage).toMatch(/#4285f4|rgb\(66, 133, 244\)/i);
	await expect(styles.backgroundSize).toBe("300% 100%");
	await expect(styles.animationName).toBe("ryu-interface-mode-gradient");
	await expect(styles.animationDuration).toBe("3s");
});
