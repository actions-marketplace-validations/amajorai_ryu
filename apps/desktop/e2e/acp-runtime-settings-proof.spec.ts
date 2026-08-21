import { expect, test } from "@playwright/test";

const STORY_URL = "/acp-runtime-settings-proof.html";

test("proves ACP lifecycle, admission, and keep-awake settings end to end", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("proof-status")).toHaveText(
		"VERIFIED · BUILT-IN"
	);
	await expect(page.getByTestId("acp-runtime-settings")).toBeVisible();
	await expect(page.getByLabel("ACP idle timeout in minutes")).toHaveValue(
		"10"
	);
	await expect(
		page
			.getByTestId("acp-runtime-settings")
			.getByText("1 active / 2 allowed", { exact: true })
	).toBeVisible();
	await expect(
		page.getByText("4 physical · 32 GiB RAM", { exact: true })
	).toBeVisible();
	await expect(page.getByRole("switch")).toBeChecked();

	const maxSelect = page.getByRole("combobox", {
		name: "Maximum parallel ACP agents",
	});
	await maxSelect.click();
	await expect(page.getByRole("option", { name: "Auto (2)" })).toBeVisible();
	await maxSelect.press("Escape");

	const idle = page.getByLabel("ACP idle timeout in minutes");
	await idle.fill("15");
	await idle.press("Enter");
	await expect(idle).toHaveValue("15");
	await expect(page.getByTestId("runtime-event-log")).toContainText(
		"idle_timeout_minutes"
	);

	await maxSelect.click();
	await page.getByRole("option", { name: "4", exact: true }).click();
	await expect(
		page
			.getByTestId("acp-runtime-settings")
			.getByText("1 active / 4 allowed", { exact: true })
	).toBeVisible();

	const keepAwake = page.getByRole("switch");
	await keepAwake.click();
	await expect(keepAwake).not.toBeChecked();
	await expect(page.getByTestId("runtime-event-log")).toContainText(
		"keep_computer_awake"
	);
	await keepAwake.click();
	await expect(keepAwake).toBeChecked();

	await expect(page.getByTestId("runtime-event-log")).toContainText(
		"Gateway saved [acp]"
	);
});
