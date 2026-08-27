import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const STORY_URL = "/sidebar-todo-progress-proof.html";

test("shows session and bot todo progress states", async ({ page }) => {
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const failedRequests: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("requestfailed", (request) =>
		failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`)
	);
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	await page.route("http://sidebar-progress-proof.local/**", (route) =>
		route.fulfill({
			body: JSON.stringify({ excluded: false }),
			contentType: "application/json",
			status: 200,
		})
	);
	await page.route("http://127.0.0.1:7980/**", (route) =>
		route.fulfill({
			body: JSON.stringify({}),
			contentType: "application/json",
			status: 200,
		})
	);

	await page.goto(STORY_URL);
	await expect(page.getByTestId("sidebar-todo-progress-proof")).toBeVisible();
	await expect(
		page.getByRole("progressbar", { name: "1 of 2 steps complete" })
	).toHaveCount(1);
	await expect(
		page.getByRole("progressbar", { name: "1 of 3 steps complete" })
	).toHaveCount(1);
	await expect(page.getByTestId("sidebar-todo-complete")).toHaveCount(1);
	await expect(page.locator(".t-plan-badge-sheen")).toHaveCount(2);
	await expect(
		page.getByTestId("sidebar-todo-complete").locator("svg")
	).toBeVisible();

	const completedReadRow = page
		.locator('div[role="button"]', { hasText: "Archive the old rollout" })
		.first();
	await expect(
		completedReadRow.getByRole("progressbar", {
			name: "2 of 2 steps complete",
		})
	).toBeVisible();
	await expect(
		completedReadRow.getByTestId("sidebar-todo-complete")
	).toHaveCount(0);

	expect(pageErrors, pageErrors.join(" | ")).toEqual([]);
	expect(consoleErrors, consoleErrors.join(" | ")).toEqual([]);
	expect(failedRequests, failedRequests.join(" | ")).toEqual([]);
	await page.screenshot({
		path: "test-results/sidebar-todo-progress-proof.png",
		fullPage: true,
	});
});
