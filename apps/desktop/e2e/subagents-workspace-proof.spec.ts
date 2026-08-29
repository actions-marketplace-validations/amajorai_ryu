import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/subagents-workspace-proof.html";

async function openStory(page: Page) {
	const browserErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	await page.goto(STORY_URL);
	await expect(page.getByTestId("subagents-roster")).toBeVisible();
	return { browserErrors, consoleErrors };
}

test("shows task-named active and completed work in one Subagents tab", async ({
	page,
}) => {
	await page.setViewportSize({ width: 720, height: 840 });
	const errors = await openStory(page);

	const workspaceTabLabel = page.getByTestId("workspace-tab-label");
	await expect(workspaceTabLabel).toHaveText("Subagents");
	await expect(workspaceTabLabel).toBeVisible();
	await expect(page.getByRole("heading", { name: "Active 5" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Done 1" })).toBeVisible();
	await expect(page.getByText("Trace stats data flow")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open Trace stats data flow" })
	).toContainText(/10m \d+s/);
	await expect(page.getByText("Review Notion history")).toBeVisible();
	await expect(page.getByText("Synthesize DuckDB findings")).toBeVisible();
	await expect(page.getByText("Inspect chart rendering")).not.toBeVisible();
	await expect(page.getByText("Working")).toHaveCount(4);
	await expect(page.getByRole("button", { name: "Show 1 more" })).toBeVisible();
	await expect(page.getByText(/16m ago/)).toBeVisible();
	await expect(page.getByText("Atlas", { exact: true })).not.toBeVisible();
	await expect(page.getByText("Nova", { exact: true })).not.toBeVisible();

	await page.screenshot({
		path: "test-results/subagents-workspace-roster.png",
		fullPage: true,
	});
	await page.getByRole("button", { name: "Show 1 more" }).click();
	await expect(page.getByText("Inspect chart rendering")).toBeVisible();

	expect(errors.browserErrors).toEqual([]);
	expect(errors.consoleErrors).toEqual([]);
});

test("opens a task transcript in place and returns to the roster", async ({
	page,
}) => {
	await page.setViewportSize({ width: 720, height: 840 });
	const errors = await openStory(page);

	await page
		.getByRole("button", { name: "Open Trace stats data flow" })
		.click();
	await expect(page.getByTestId("subagent-detail")).toBeVisible();
	await expect(page.getByTestId("workspace-tab-label")).toHaveText("Subagents");
	await expect(page.getByTestId("workspace-tab-label")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Trace stats data flow" })
	).toBeVisible();
	await page.screenshot({
		path: "test-results/subagents-workspace-detail.png",
		fullPage: true,
	});
	await page.getByRole("button", { name: "Back to subagents" }).click();
	await expect(page.getByTestId("subagents-roster")).toBeVisible();

	expect(errors.browserErrors).toEqual([]);
	expect(errors.consoleErrors).toEqual([]);
});

test("keeps an honest empty state before any task is delegated", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?empty=1`);
	await expect(
		page.getByText("Subagents will appear here when this chat delegates work.")
	).toBeVisible();
});
