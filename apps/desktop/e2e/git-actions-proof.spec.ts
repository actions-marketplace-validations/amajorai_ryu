import { expect, type Page, test } from "@playwright/test";

const STORY_URL = "/git-actions-proof.html";

async function closeCommitDialog(page: Page) {
	const message = page.getByPlaceholder(
		"Commit message (leave blank to generate)…"
	);
	await expect(message).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(message).toBeHidden();
}

test("matches the commit and push dialog reference options", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(
		page.getByPlaceholder("Commit message (leave blank to generate)…")
	).toBeVisible();
	await expect(page.getByText("Include unstaged changes")).toBeVisible();
	await expect(
		page.getByRole("checkbox", {
			name: "Include unstaged changes +76,383 −8,438",
		})
	).toBeVisible();
	for (const label of [/^Commit(?: ⌘↵)?$/, "Commit and push", "Push"]) {
		await expect(
			page.getByRole("button", { name: label, exact: true })
		).toBeVisible();
	}
	await closeCommitDialog(page);
	await page.getByRole("button", { name: "Pull latest changes" }).click();
	await expect(page.getByText("Pulling…", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Stop git action" })
	).toHaveCount(0);
	await page.reload();
	await expect(
		page.getByPlaceholder("Commit message (leave blank to generate)…")
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByPlaceholder("Commit message (leave blank to generate)…")
	).toBeHidden();
	await page.getByRole("button", { name: "Sync with remote" }).click();
	await expect(page.getByText("Syncing…", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Stop git action" })
	).toHaveCount(0);
	await page.screenshot({
		fullPage: true,
		path: "/Users/jiawei/Documents/Code/ryu/apps/desktop/test-results/git-remote-sync-no-stop-proof.png",
	});
	await page.reload();
	await expect(
		page.getByPlaceholder("Commit message (leave blank to generate)…")
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByPlaceholder("Commit message (leave blank to generate)…")
	).toBeHidden();

	await page.getByTestId("show-generating").click();
	await expect(
		page.getByText("Generating message…", { exact: true })
	).toBeVisible();
	await page.getByRole("button", { name: "Stop git action" }).click();
	await expect(page.getByText("Commit or push is ready.")).toBeVisible();
	await page.getByTestId("open-commit-dialog").click();

	await page.getByRole("button", { name: /^Commit(?: ⌘↵)?$/ }).click();
	await expect(page.getByText("Committing…", { exact: true })).toBeVisible();
});

test("matches the create pull request dialog reference options", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await closeCommitDialog(page);
	await page.getByTestId("open-pr-dialog").click();

	await expect(
		page.getByText("codex/gateway-posture-doctor → main")
	).toBeVisible();
	await expect(page.getByPlaceholder("Title")).toBeVisible();
	await expect(
		page.getByPlaceholder("Description (leave empty to generate)")
	).toBeVisible();
	await expect(page.getByText("Commit and push local changes")).toBeVisible();
	for (const label of ["Create draft PR", /^Create PR/, "Open PR in browser"]) {
		await expect(
			page.getByRole("button", { name: label, exact: true })
		).toBeVisible();
	}
});

test("shows the GitHub PR and CI rollup in the environment and chat hover", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await closeCommitDialog(page);

	const summary = page.getByTestId("pr-ci-summary");
	await expect(summary).toContainText("Harden Gateway posture checks");
	await expect(summary).toContainText("4 failing checks");
	await expect(summary).toContainText("3 comments");
	await expect(
		summary.getByTestId("pull-request-status-icon-552")
	).toHaveAttribute("data-status", "open");
	await expect(
		page.getByTestId("code-mode-pr-statuses").locator('[role="img"]')
	).toHaveCount(4);
	for (const status of ["open", "draft", "closed", "merged"]) {
		await expect(
			page
				.getByTestId("code-mode-pr-statuses")
				.locator(`[data-status="${status}"]`)
		).toBeVisible();
	}
	await expect(
		summary.getByRole("link", { name: /Open pull request/ })
	).toHaveAttribute("href", "https://github.com/amajorai/ryu/pull/552");
	await summary.getByRole("button", { name: "Fix" }).click();
	await expect(page.getByTestId("ci-report-attached")).toHaveText(
		"Attached ci-failures-pr-552.txt"
	);

	await page.getByTestId("sidebar-chat-trigger").hover();
	const hoverSummary = page.getByTestId("pull-request-summary-552").last();
	await expect(hoverSummary).toBeVisible();
	await expect(hoverSummary).toContainText("4 failing checks");
	await expect(hoverSummary).toContainText("3 comments");

	await page.screenshot({
		fullPage: true,
		path: "/Users/jiawei/Documents/Code/ryu/apps/desktop/test-results/git-pull-sync-proof.png",
	});
});
