import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const PROOF_DIR = "/Users/jiawei/Documents/Code/ryu/docs/proof";
const PROOF_SCREENSHOT = `${PROOF_DIR}/agent-version-history-proof.png`;
const PROOF_LOG = `${PROOF_DIR}/agent-version-history-proof.log.json`;

test("agent editor exposes complete configuration snapshot, diff, and restore", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	const failedRequests: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => consoleErrors.push(String(error)));
	page.on("requestfailed", (request) => {
		failedRequests.push(
			`${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`
		);
	});

	await page.goto("/agent-version-history-proof.html");
	await expect(page).toHaveTitle("Agent version history proof");
	await expect(page.getByTestId("proof-status")).toContainText(
		"snapshot, diff, restore"
	);
	await expect(page.getByRole("tab", { name: "Versions" })).toBeVisible();
	await expect(page.getByText("Agent configuration history")).toBeVisible();
	await expect(
		page.getByText("Compare, test, and roll back", { exact: true })
	).toBeVisible();

	await page.getByRole("button", { name: "Save version" }).click();
	await page.getByRole("button", { name: "History" }).click();
	await expect(
		page.getByText("Regression baseline", { exact: true })
	).toBeVisible();
	await expect(
		page.getByText("Research Copilot · v1.0.0", { exact: true })
	).toBeVisible();

	await page.getByRole("button", { name: "Diff" }).first().click();
	await expect(
		page.locator("pre").filter({ hasText: "system_prompt" }).first()
	).toContainText("flag uncertainty");
	await expect(
		page.locator("pre").filter({ hasText: "system_prompt" }).first()
	).toContainText("-");

	await page.getByRole("button", { name: "Restore" }).first().click();
	await expect(page.getByTestId("version-status")).toContainText(
		"ready to test"
	);
	await expect(page.getByTestId("current-config")).toContainText(
		"Answer with cited research."
	);
	await expect(page.getByTestId("current-config")).not.toContainText(
		"flag uncertainty"
	);

	await page.getByRole("button", { name: "History" }).click();
	await expect(
		page.getByText("Regression baseline", { exact: true })
	).toBeVisible();
	await mkdir(PROOF_DIR, { recursive: true });
	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
	await writeFile(
		PROOF_LOG,
		JSON.stringify({ consoleErrors, failedRequests }, null, 2)
	);

	expect(consoleErrors).toEqual([]);
	expect(failedRequests).toEqual([]);
});
