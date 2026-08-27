import { expect, test } from "@playwright/test";

const PROOF_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/25/01a03916-ee8c-7552-ab02-c72fe2dd4a39/ryu-bot-product-proof.png";

test.describe.configure({ timeout: 90_000 });

test("proves the managed Bot desktop shell keeps Build controls hidden", async ({
	page,
}) => {
	await page.setViewportSize({ height: 900, width: 1440 });
	await page.goto("/bot-product-shell-proof.html?reset=1");

	await expect(page.locator('[data-product="ryu-bot"]')).toBeVisible();
	await expect(
		page.getByTestId("product-mode-lockup").getByText("Ryu", { exact: true })
	).toBeVisible();
	await expect(
		page.getByTestId("product-mode-lockup").getByText("Bot", { exact: true })
	).toBeVisible();
	await expect(page.getByTestId("bot-connection-status")).toContainText(
		"Connected"
	);
	await expect(page.getByTestId("bot-managed-default")).toHaveText(
		"Ryu-managed models"
	);
	await expect(
		page.getByText("Plan my weekend", { exact: true })
	).toBeVisible();
	await expect(page.getByRole("button", { name: "New section" })).toHaveCount(
		0
	);
	await expect(
		page.getByRole("button", { name: "Import a past agent thread" })
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Agent, model and mode settings" })
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Choose provider and model" })
	).toHaveCount(0);

	const composer = page.locator("textarea").first();
	await composer.fill("@");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await composer.fill("Hello from Bot");
	await composer.press("Enter");
	await expect(page.getByTestId("bot-sent-message")).toHaveText(
		"Hello from Bot"
	);

	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
});
