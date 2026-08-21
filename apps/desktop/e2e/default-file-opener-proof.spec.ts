import { expect, test } from "@playwright/test";

const STORY_URL = "/default-file-opener-proof.html";

test.describe("default shell and file opener settings", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(STORY_URL);
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test("starts on OS defaults and names the platform file manager", async ({
		page,
	}) => {
		await expect(
			page.getByRole("combobox", { name: "Default shell" })
		).toHaveValue("auto");
		const opener = page.getByRole("combobox", {
			name: "Default file opener",
		});
		await expect(opener).toHaveValue("system");
		await expect(opener.locator("option:checked")).toHaveText(
			/OS default \((Finder|Explorer|Files)\)/
		);
	});

	test("persists a selected editor and resets both defaults", async ({
		page,
	}) => {
		await page
			.getByRole("combobox", { name: "Default shell" })
			.selectOption("zsh");
		await page
			.getByRole("combobox", { name: "Default file opener" })
			.selectOption("cursor");

		await page.reload();
		await expect(
			page.getByRole("combobox", { name: "Default shell" })
		).toHaveValue("zsh");
		await expect(
			page.getByRole("combobox", { name: "Default file opener" })
		).toHaveValue("cursor");

		await page.getByRole("button", { name: "Reset to OS defaults" }).click();
		await expect(
			page.getByRole("combobox", { name: "Default shell" })
		).toHaveValue("auto");
		await expect(
			page.getByRole("combobox", { name: "Default file opener" })
		).toHaveValue("system");
		await expect(page.getByTestId("proof-status")).toHaveText(
			"Defaults restored: OS shell and OS file opener"
		);
	});
});
