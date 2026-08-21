import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/worktree-handoff-proof.html";
const PROOF_SCREENSHOT =
	"/Users/jiawei/Documents/Code/ryu/apps/desktop/test-results/worktree-handoff-proof.png";
const PROOF_RESULT_SCREENSHOT =
	"/Users/jiawei/Documents/Code/ryu/apps/desktop/test-results/worktree-handoff-result.png";

test("hands off the pinned Environment chat to a named worktree", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const environment = page.getByTestId("environment-section");
	await expect(environment).toContainText("Environment");
	await environment.getByTestId("open-worktree-handoff").click();

	await expect(
		page.getByRole("heading", { name: "Hand off chat to worktree" })
	).toBeVisible();
	await expect(
		page.getByText(
			"Create and check out a branch in a new worktree to continue working in parallel."
		)
	).toBeVisible();
	await expect(page.getByLabel("Branch name")).toHaveValue(
		"codex/release-version-020"
	);
	await expect(
		page.getByText(
			"This chat is running, so handing it off will interrupt the current response"
		)
	).toBeVisible();

	await page.screenshot({ animations: "disabled", path: PROOF_SCREENSHOT });

	const branch = page.getByLabel("Branch name");
	await branch.fill("codex/release-version-021");
	await page.getByRole("button", { name: "Hand off", exact: true }).click();

	await expect(page.getByTestId("worktree-handoff-dialog")).toBeHidden();
	await expect(page.getByTestId("chat-state")).toHaveText("Interrupted");
	await expect(page.getByTestId("handoff-result")).toHaveText(
		"Handed off to codex/release-version-021"
	);
	await page.screenshot({
		animations: "disabled",
		path: PROOF_RESULT_SCREENSHOT,
	});
});
