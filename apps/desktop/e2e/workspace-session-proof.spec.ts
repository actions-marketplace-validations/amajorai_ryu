import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("a chat relaunch restores every open workspace tab and its selection", async ({
	page,
}) => {
	const browserLogs: string[] = [];
	const browserErrors: string[] = [];
	page.on("console", (message) =>
		browserLogs.push(`${message.type()}: ${message.text()}`)
	);
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto("/workspace-session-proof.html");
	await expect(page.getByTestId("proof-status")).toHaveText("Demo chat ready");
	await expect(page.getByTestId("tab-count")).toHaveText("5 across two docks");

	await page.getByTestId("save-session").click();
	await expect(page.getByTestId("chat-state")).toHaveText("Session saved");

	await page.reload();
	await expect(page.getByTestId("proof-status")).toHaveText(
		"PASS · full workspace restored"
	);
	await expect(page.getByTestId("chat-state")).toHaveText(
		"Restored from saved chat session"
	);
	await expect(page.getByTestId("tab-count")).toHaveText("5 across two docks");
	await expect(page.getByTestId("bottom-dock-state")).toHaveText("Open");
	await expect(page.getByTestId("right-dock-state")).toHaveText("Open");
	await expect(page.getByTestId("bottom-tab-1")).toHaveAttribute(
		"data-active",
		"true"
	);
	await expect(page.getByTestId("right-tab-2")).toHaveAttribute(
		"data-active",
		"true"
	);
	await expect(page.getByTestId("bottom-tab-0")).toContainText("Terminal");
	await expect(page.getByTestId("right-tab-0")).toContainText("Files");
	await expect(page.getByTestId("right-tab-1")).toContainText("Sources");
	await expect(page.getByTestId("right-tab-2")).toContainText("Subagents");
	await expect(page.getByTestId("activity-log")).toContainText(
		"Browser loaded the persisted chat snapshot"
	);

	expect(browserErrors).toEqual([]);
	// Keep the browser log capture as part of the proof contract; an empty log is
	// expected for this isolated persistence surface.
	expect(browserLogs.filter((entry) => entry.startsWith("error:"))).toEqual([]);
	await page.screenshot({
		path: "test-results/workspace-session-proof.png",
		fullPage: true,
	});
});
