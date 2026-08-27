import path from "node:path";
import { expect, test } from "@playwright/test";

const STORY_URL = "/node-lifecycle-capability-proof.html";

test("renders the node scope, ACL decisions, and access-first matrix", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page.waitForLoadState("networkidle");

	await expect(page.getByTestId("proof-status")).toContainText(
		"8/8 contract decisions verified"
	);
	await expect(page.getByTestId("node-scope-card")).toContainText(
		"node-team-7"
	);
	await expect(page.getByTestId("node-scope-card")).toContainText(
		"team:team-7"
	);
	await expect(page.getByTestId("github-bridge-card")).toContainText(
		"Ryu Marketplace"
	);
	await expect(page.getByTestId("github-bridge-card")).toContainText(
		"ryu-marketplace"
	);
	await expect(page.getByTestId("github-bridge-card")).toContainText("4625892");
	await expect(page.getByTestId("github-bridge-card")).toContainText(
		"validated"
	);
	await expect(page.getByTestId("webhook-check")).toContainText(
		"active · secret configured"
	);
	await expect(page.getByTestId("permission-card")).toContainText(
		"app.install"
	);
	await expect(page.getByTestId("permission-card")).toContainText(
		"app.uninstall"
	);

	for (const id of [
		"team-grant",
		"admin-team-node",
		"paid-update",
		"paid-download",
		"paid-disable",
		"paid-uninstall",
	]) {
		await expect(page.getByTestId(`result-${id}`)).toHaveText("allowed");
	}
	for (const id of ["member-denied", "individual-deny"]) {
		await expect(page.getByTestId(`result-${id}`)).toHaveText("denied");
	}

	await expect(page.getByTestId("captured-logs")).toContainText('"status":403');
	await expect(page.getByTestId("captured-logs")).toContainText(
		'"node_scope":"team:team-7"'
	);
	await expect(page.getByTestId("captured-logs")).toContainText(
		'"required_permission":"app.install"'
	);
	await page.screenshot({
		fullPage: true,
		path: path.resolve(
			import.meta.dirname,
			"harness/node-lifecycle-capability-proof.png"
		),
	});
});

test("re-runs the captured server decision matrix", async ({ page }) => {
	await page.goto(STORY_URL);
	await page.waitForLoadState("networkidle");
	await expect(
		page.getByText("Run 1 · captured gateway responses")
	).toBeVisible();

	await page.getByRole("button", { name: "Re-run matrix" }).click();
	await expect(
		page.getByText("Run 2 · captured gateway responses")
	).toBeVisible();
	await expect(page.getByTestId("proof-status")).toContainText(
		"8/8 contract decisions verified"
	);
});
