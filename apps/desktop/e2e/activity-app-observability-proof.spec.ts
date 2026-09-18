import { expect, test } from "@playwright/test";

test("Activity Companion exposes the observe-to-evaluate workflow", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto("/activity-app-observability-proof.html", {
		waitUntil: "domcontentloaded",
	});
	await expect(page.getByTestId("activity-proof-status")).toHaveText(
		"Activity Companion mounted"
	);
	await page.getByRole("tab", { name: "Observability" }).click();
	await expect(page.getByText("Agent observability").first()).toBeVisible();
	await expect(page.getByText("Requests").first()).toBeVisible();
	await page.getByLabel("Observability window").selectOption("7d");
	await expect(page.getByText("Last 7 days").first()).toBeVisible();
	await page.getByLabel("Search observability").fill("gpt-4o-mini");
	const regexSwitch = page
		.locator("label")
		.filter({ hasText: "Regex" })
		.locator('[data-slot="switch"]');
	await regexSwitch.click();
	await expect(
		page.getByTestId("observability-event-audit-proof-success")
	).toBeVisible();
	await regexSwitch.click();
	await page.getByLabel("Search observability").fill("");
	await page.getByLabel("Saved observability view name").fill("Seven day view");
	await page.getByRole("button", { name: "Save current view" }).click();
	await expect(
		page.getByRole("button", { exact: true, name: "Seven day view" })
	).toBeVisible();
	await page.getByTestId("observability-event-audit-proof-success").click();
	await expect(page.getByText("Core run spans")).toBeVisible();
	await expect(page.getByText("search_docs")).toBeVisible();
	await page.getByRole("button", { name: "Prune local audit" }).click();
	await expect(page.getByText(/Retention applied/)).toBeVisible();
	await page.getByLabel("Completed output to score").fill("A grounded answer.");
	await page
		.getByLabel("Online scoring rubric")
		.fill("The answer is grounded.");
	await page.getByRole("button", { name: "Score output" }).click();
	await expect(page.getByText("Online score 91%")).toBeVisible();
	await page.getByRole("button", { name: "Run quality eval" }).click();
	await expect(page.getByText("Overall 88%")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Run quality eval" })
	).toBeEnabled();
	await page.getByRole("button", { name: "Add to Quality tests" }).click();
	await expect(page.getByText(/Added to Agent regression suite/)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add to Quality tests" })
	).toBeEnabled();
	await page.getByRole("button", { name: "Run security checks" }).click();
	await expect(page.getByText("5/5 protected")).toBeVisible();
	await expect(page.getByText("Prompt injection")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Run security checks" })
	).toBeEnabled();

	await page.screenshot({
		fullPage: true,
		path: "artifacts/activity-app-observability-proof-complete.png",
	});
	await page.setViewportSize({ width: 480, height: 900 });
	await page.screenshot({
		fullPage: true,
		path: "artifacts/activity-app-observability-proof-narrow.png",
	});
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		fullPage: true,
		path: "artifacts/activity-app-observability-proof-dark.png",
	});

	expect(browserErrors).toEqual([]);
});
