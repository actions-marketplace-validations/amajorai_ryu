import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/remote-project-sidebar-status-proof.html";
const PROOF_DIR = process.env.RYU_PROOF_DIR;

test("renders remote project connection states without labeling local folders", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	const proof = page.getByTestId("remote-project-sidebar-status-proof");
	await expect(proof).toHaveAttribute("data-harness-ready", "1");
	await expect(page.getByTestId("current-state")).toHaveText("online");
	await expect(
		page
			.getByTestId("project-row-codex-testing")
			.locator("[data-project-connection-status]")
	).toHaveAttribute("data-project-connection-status", "online");
	if (PROOF_DIR) {
		await page.screenshot({
			fullPage: true,
			path: path.join(PROOF_DIR, "remote-project-sidebar-online.png"),
		});
	}
	await expect(
		page
			.getByTestId("project-row-work")
			.locator("[data-project-connection-status]")
	).toHaveAttribute("data-project-connection-status", "online");
	await expect(
		page
			.getByTestId("project-row-local-notes")
			.locator("[data-project-connection-status]")
	).toHaveCount(0);

	await page.getByRole("button", { name: "Offline" }).click();
	await expect(page.getByTestId("current-state")).toHaveText("offline");
	await expect(
		page
			.getByTestId("project-row-hello")
			.locator("[data-project-connection-status]")
	).toHaveAttribute("data-project-connection-status", "offline");
	await expect(
		page.getByTestId("project-row-hello").locator("[data-connection-dot-state]")
	).toHaveAttribute("data-connection-dot-state", "offline");
	if (PROOF_DIR) {
		await page.screenshot({
			fullPage: true,
			path: path.join(PROOF_DIR, "remote-project-sidebar-offline.png"),
		});
	}

	await page.getByRole("button", { name: "Checking" }).click();
	await expect(
		page
			.getByTestId("project-row-hello")
			.locator("[data-project-connection-status]")
	).toHaveAttribute("data-project-connection-status", "checking");
});
