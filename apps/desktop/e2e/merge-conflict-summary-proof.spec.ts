import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/merge-conflict-summary-proof.html";
const PROOF_SCREENSHOT =
	"/Users/jiawei/.codex/visualizations/2026/08/21/01a023e6-d9f4-7933-a25a-b98ef22168a8/merge-conflict-summary-proof.png";

test("shows merge conflicts in the pinned summary and stages a Fix report", async ({
	page,
}) => {
	await page.setViewportSize({ height: 620, width: 480 });
	await page.goto(STORY_URL);

	const summary = page.getByTestId("pull-request-summary-42");
	const conflicts = page.getByTestId("pull-request-merge-conflicts-42");

	await expect(summary).toBeVisible();
	await expect(conflicts).toBeVisible();
	await expect(conflicts.getByText("Merge conflicts")).toBeVisible();
	await expect(
		conflicts.getByRole("button", {
			name: "Fix merge conflicts in pull request #42",
		})
	).toBeVisible();
	await expect(summary.getByText("3 comments")).toBeVisible();

	await conflicts
		.getByRole("button", {
			name: "Fix merge conflicts in pull request #42",
		})
		.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Merge conflict report staged" })
	).toBeVisible();

	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
});
