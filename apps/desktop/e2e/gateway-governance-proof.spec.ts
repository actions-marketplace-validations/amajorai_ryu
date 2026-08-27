import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

test("shows hook governance, developer tabs, and client surfaces", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await page.goto("/gateway-governance-proof.html");
	await page.waitForLoadState("networkidle");
	await expect(
		page.getByRole("heading", { name: /Hooks, developer defaults/ })
	).toBeVisible();
	await expect(page.getByText("From plugins")).toBeVisible();
	await expect(page.getByText("From config")).toBeVisible();
	await expect(page.getByText("Security Guidance")).toBeVisible();
	await expect(page.getByText("1 needs review")).toBeVisible();
	await page.getByRole("button", { name: "Show details for review" }).click();
	await expect(page.getByText("Sandboxed JavaScript")).toBeVisible();
	await expect(page.getByText("hooks/review.js")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Trust review" })
	).toBeVisible();

	for (const heading of [
		"Git",
		"Worktrees",
		"Environments",
		"Connected devices",
	]) {
		await expect(
			page.getByRole("heading", { name: heading, exact: true })
		).toBeVisible();
	}
	for (const label of ["Desktop app", "CLI", "Mobile", "Browser extension"]) {
		await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
	}

	const nodeTrigger = page.getByRole("button", { name: /local/i }).first();
	if (await nodeTrigger.isVisible()) {
		await nodeTrigger.click();
		await expect(page.getByText("CLI", { exact: false }).last()).toBeVisible();
	}

	if (errors.length > 0) {
		throw new Error(
			`Gateway governance proof logged browser errors: ${errors.join(" | ")}`
		);
	}

	await page.screenshot({
		fullPage: true,
		path: path.resolve(
			test.info().project.testDir,
			"../../..",
			"artifacts",
			"gateway-governance-tabs-proof.png"
		),
	});
});
