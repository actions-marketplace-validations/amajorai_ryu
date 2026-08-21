import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("the selected Space menu exposes actions and renames the Space", async ({
	page,
}) => {
	await page.goto("/space-actions-story.html");

	const trigger = page.getByRole("button", {
		name: "Research notes options",
	});
	await trigger.focus();
	await page.keyboard.press("Enter");

	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem", { name: /Add files/ })).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: /Change icon/ })
	).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: /Delete space/ })
	).toBeVisible();
	await expect(
		menu.getByRole("menuitem", { name: /Rename space/ })
	).toBeVisible();

	await menu.getByRole("menuitem", { name: /Rename space/ }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "Rename space" })
	).toBeVisible();
	const input = dialog.getByRole("textbox", { name: "Name" });
	await input.fill("Project notes");
	await dialog.getByRole("button", { name: "Save" }).click();

	await expect(page.getByTestId("space-name")).toHaveText("Project notes");
	await expect(page.getByTestId("action-status")).toHaveText(
		"Renamed to Project notes"
	);
	await expect(
		page.getByRole("button", { name: "Project notes options" })
	).toBeVisible();
});
