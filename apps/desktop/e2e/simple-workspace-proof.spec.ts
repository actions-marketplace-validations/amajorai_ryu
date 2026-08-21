import { expect, test } from "@playwright/test";

const PROOF_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/18/01a0137e-1cd7-7f50-add7-23f4915d2d1d/simple-workspace-proof.png";

test("proves Simple workspace and branch-gated PR behavior", async ({
	page,
}) => {
	await page.setViewportSize({ height: 1000, width: 1440 });
	await page.goto("/simple-workspace-proof.html");

	await expect(page.getByTestId("composer-footer")).toHaveText(
		"Simple mode · no project picker"
	);
	await expect(page.getByTestId("workspace-required-dialog")).toHaveCount(0);

	await page
		.getByRole("textbox", { name: "Chat message" })
		.fill("Fix the failing tests in this repo");
	await page.getByTestId("send-message").click();
	await expect(page.getByTestId("workspace-required-dialog")).toBeVisible();
	await page.getByTestId("choose-project").click();
	await expect(page.getByTestId("workspace-required-dialog")).toHaveCount(0);
	await expect(page.getByTestId("pinned-summary-folder")).toContainText(
		"ryu-closed"
	);
	await expect(page.getByTestId("files-changed")).toHaveText("3 files changed");
	await expect(page.getByTestId("create-pull-request")).toBeVisible();
	await expect(page.getByTestId("environment-summary")).not.toContainText("+");

	await page.getByTestId("toggle-branch").click();
	await expect(page.getByText("main", { exact: true })).toBeVisible();
	await expect(page.getByTestId("create-pull-request")).toHaveCount(0);
	await page.getByTestId("toggle-branch").click();
	await expect(page.getByTestId("create-pull-request")).toBeVisible();

	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
});
