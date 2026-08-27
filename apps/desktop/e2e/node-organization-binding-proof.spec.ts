import path from "node:path";
import { expect, test } from "@playwright/test";

const STORY_URL = "/node-organization-binding-proof.html";

test.describe.configure({ timeout: 120_000 });

test("binds the active Core and proves the saved organization after reload", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});

	await page.goto(STORY_URL);
	await page.waitForTimeout(500);
	if (errors.length > 0) {
		throw new Error(`Proof failed to render: ${errors.join(" | ")}`);
	}
	await page.getByRole("combobox", { name: "Organization" }).click();
	await page.getByRole("option", { name: "Acme Research" }).click();
	await expect(page.getByText("One secure enrollment")).toBeVisible();
	await page.getByRole("button", { name: "Bind node" }).click();
	await expect(page.getByText("Managed inference ready")).toBeVisible();

	await page.reload();
	await expect(
		page.getByTestId("node-organization-binding-ready")
	).toBeVisible();
	await expect(page.getByTestId("bound-organization")).toHaveText(
		"Acme Research"
	);
	await expect(page.getByText("node_studio_7f3a")).toBeVisible();
	await expect(page.getByRole("button", { name: "Bind node" })).toHaveCount(0);

	if (errors.length > 0) {
		throw new Error(
			`Organization binding proof logged errors: ${errors.join(" | ")}`
		);
	}

	await page.screenshot({
		fullPage: true,
		path: path.resolve(
			test.info().project.testDir,
			"proof",
			"self-hosted-node-org-binding-proof.png"
		),
	});
});

test("shows a read-only explanation without a binding action", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?readonly=1`);
	await page.getByRole("combobox", { name: "Organization" }).click();
	await page.getByRole("option", { name: "Acme Research" }).click();
	await expect(page.getByText("Read-only access")).toBeVisible();
	await expect(page.getByText(/gateway\.configure/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Bind node" })).toBeDisabled();
});

test("shows a permission error and recovers through retry", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?permissionsError=1`);
	await page.getByRole("combobox", { name: "Organization" }).click();
	await page.getByRole("option", { name: "Acme Research" }).click();
	await expect(page.getByText("Could not check access")).toBeVisible();
	await page.getByRole("button", { name: "Retry access check" }).click();
	await expect(page.getByText("One secure enrollment")).toBeVisible();
});

test("refreshes status when the enroll response is lost after Core saves", async ({
	page,
}) => {
	await page.goto(`${STORY_URL}?lostEnrollResponse=1`);
	await page.getByRole("combobox", { name: "Organization" }).click();
	await page.getByRole("option", { name: "Acme Research" }).click();
	await page.getByRole("button", { name: "Bind node" }).click();
	await expect(page.getByText("Managed inference ready")).toBeVisible();
	await expect(page.getByTestId("bound-organization")).toHaveText(
		"Acme Research"
	);
});

test("supports keyboard-only binding and announces the completed status", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	const organization = page.getByRole("combobox", { name: "Organization" });
	await expect(organization).toBeVisible();
	await page.keyboard.press("Tab");
	await expect(organization).toBeFocused();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(organization).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(page.getByLabel("Node name")).toBeFocused();
	await expect(page.getByText("One secure enrollment")).toBeVisible();
	await page.keyboard.press("Tab");
	const bindButton = page.getByRole("button", { name: "Bind node" });
	await expect(bindButton).toBeFocused();
	await expect(bindButton).toHaveClass(/bg-secondary/);
	await page.keyboard.press("Enter");
	const completed = page.getByRole("status");
	await expect(completed).toContainText("Managed inference ready");
	await expect(completed).toHaveAttribute("aria-live", "polite");
	await expect(page.getByText("Managed inference ready")).toHaveClass(
		/bg-secondary/
	);
});

test("reflows a long organization name at 200% in light mode", async ({
	page,
}) => {
	await page.setViewportSize({ height: 900, width: 640 });
	await page.goto(`${STORY_URL}?bound=1&longName=1&light=1`);
	await page.evaluate(() => {
		document.documentElement.style.zoom = "2";
	});
	await expect(page.locator("html")).toHaveClass(/light/);
	await expect(page.getByRole("status")).toBeVisible();
	const hasHorizontalOverflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth
	);
	expect(hasHorizontalOverflow).toBe(false);
	await page.screenshot({
		fullPage: true,
		path: path.resolve(
			test.info().project.testDir,
			"proof",
			"self-hosted-node-org-binding-light-reflow-proof.png"
		),
	});
});
