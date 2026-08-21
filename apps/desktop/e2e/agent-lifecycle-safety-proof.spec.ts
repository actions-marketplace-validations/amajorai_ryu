import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const PROOF_DIR = "/Users/jiawei/Documents/Code/ryu-closed/docs/proof";
const PROOF_SCREENSHOT = `${PROOF_DIR}/agent-lifecycle-safety-proof.png`;
const PROOF_LOG = `${PROOF_DIR}/agent-lifecycle-safety-proof.log.json`;

test("new agents expose an enforced trial and safety boundary", async ({
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

	await page.goto("/agent-lifecycle-safety-proof.html");
	const panel = page.getByTestId("lifecycle-safety-proof");
	await expect(panel).toBeVisible();
	await expect(
		panel.locator('[data-slot="badge"]').getByText("Trial", { exact: true })
	).toBeVisible();
	await expect(page.getByTestId("effective-profile")).toHaveText("Read-only");
	await expect(page.getByTestId("saved-profile")).toHaveText("Autonomous");
	await expect(
		page.getByLabel("Agent lifecycle").locator('option[value="active"]')
	).toHaveAttribute("disabled", "");

	await page.getByLabel("Agent lifecycle").selectOption("draft");
	await expect(panel).toContainText("authoring-only");
	await page.getByLabel("Agent lifecycle").selectOption("trial");
	await page
		.getByLabel("Agent safety profile")
		.selectOption("approval_required");
	await expect(page.getByTestId("saved-profile")).toHaveText(
		"Approval required"
	);
	await expect(panel).toContainText("Effective safety: Read-only");

	await mkdir(PROOF_DIR, { recursive: true });
	await page.screenshot({ path: PROOF_SCREENSHOT, fullPage: true });
	await writeFile(
		PROOF_LOG,
		JSON.stringify({ consoleErrors, failedRequests }, null, 2)
	);

	expect(consoleErrors).toEqual([]);
	expect(failedRequests).toEqual([]);
});
