import { expect, test } from "@playwright/test";

test("agent observability keeps the observe-to-trace workflow visible", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => browserErrors.push(error.message));

	await page.goto("/agent-observability-proof.html", {
		waitUntil: "domcontentloaded",
	});
	await page.waitForLoadState("networkidle");
	await expect(page.getByTestId("proof-status")).toHaveText(
		"Production UI mounted"
	);
	await expect(page.getByText("Agent observability").first()).toBeVisible();
	await expect(page.getByTestId("observability-summary")).toContainText(
		"Requests"
	);
	await expect(page.getByTestId("observability-events")).toContainText(
		"gpt-4o-mini"
	);
	await page.getByLabel("Observability filter").selectOption("errors");
	await expect(page.getByTestId("observability-events")).toContainText(
		"claude-3-5-sonnet"
	);
	await page.getByLabel("Observability filter").selectOption("all");
	await page.getByLabel("Observability window").selectOption("7d");
	await expect(page.getByTestId("observability-summary")).toContainText(
		"Last 7 days"
	);

	await page.getByTestId("observability-search").fill("gpt-4o-mini");
	await expect(page.getByTestId("observability-events")).toContainText(
		"gpt-4o-mini"
	);
	await expect(page.getByTestId("observability-events")).not.toContainText(
		"claude-3-5-sonnet"
	);
	await page.getByTestId("observability-event-audit-proof-success").click();
	await expect(page.getByTestId("observability-trace")).toContainText(
		"Core run spans"
	);
	await expect(page.getByTestId("observability-trace")).toContainText(
		"search_docs"
	);
	await page
		.getByLabel("Saved observability view name")
		.fill("Successful model calls");
	await page.getByRole("button", { name: "Save current view" }).click();
	await expect(
		page.getByRole("button", { exact: true, name: "Successful model calls" })
	).toBeVisible();
	await page.getByRole("button", { name: "Prune local audit" }).click();
	await expect(page.getByText(/Retention applied/)).toBeVisible();
	await page.getByLabel("Completed output to score").fill("A grounded answer.");
	await page
		.getByLabel("Online scoring rubric")
		.fill("The answer is grounded.");
	await page.getByRole("button", { name: "Score output" }).click();
	await expect(page.getByText("Online score 91%")).toBeVisible();
	await page.getByRole("button", { name: "Add to Quality tests" }).click();
	await expect(page.getByText(/Added to Agent regression suite/)).toBeVisible();
	await page.getByRole("button", { name: "Open conversation" }).click();
	await expect(page.locator("body")).toHaveAttribute(
		"data-opened-run",
		"run-proof-success"
	);
	await page.getByTestId("observability-security-run").click();
	await expect(page.getByTestId("observability-security-result")).toContainText(
		"5/5 protected"
	);
	await expect(page.getByTestId("observability-security-result")).toContainText(
		"Prompt injection"
	);

	await page.screenshot({
		fullPage: true,
		path: "artifacts/agent-observability-proof-complete.png",
	});
	await page.setViewportSize({ width: 480, height: 900 });
	await page.screenshot({
		fullPage: true,
		path: "artifacts/agent-observability-proof-narrow.png",
	});
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		fullPage: true,
		path: "artifacts/agent-observability-proof-dark.png",
	});

	expect(browserErrors).toEqual([]);
});
