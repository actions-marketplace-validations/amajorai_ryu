import { expect, test } from "@playwright/test";

const STORY_URL = "/credit-usage-charts-proof.html";

test("shows credit spend charts alongside the transactions list", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("credit-usage-view")).toBeVisible();
	await expect(page.getByTestId("usage-analytics-dashboard")).toBeVisible();
	await expect(page.getByTestId("usage-kpi-active-nodes")).toContainText("3");
	await expect(
		page.getByRole("heading", { name: "Credit usage analytics" })
	).toBeVisible();

	for (const kind of [
		"trend",
		"source",
		"provider",
		"feature-mix",
		"model",
		"provider-ranking",
		"heatmap",
	]) {
		const chart = page.getByTestId(`usage-analytics-chart-${kind}`);
		await expect(chart).toBeVisible();
	}

	for (const kind of ["reason", "model", "provider"]) {
		const chart = page.getByTestId(`usage-chart-${kind}`);
		await expect(chart).toBeVisible();
		await expect(chart.locator("[data-slot='chart']")).toHaveCount(1);
		await expect(chart.locator("svg")).toHaveCount(1);
	}

	await expect(page.getByText("Summarize release notes")).toBeVisible();
	await expect(page.getByText("Top-up")).toBeVisible();
	await expect(page.getByTestId("proof-status")).toContainText(
		"provider/model filters"
	);
});

test("keeps credit receipts out of spend breakdowns", async ({ page }) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("usage-chart-reason")).not.toContainText(
		"Top-up"
	);
	await expect(
		page.getByTestId("usage-chart-reason").getByText("Model usage")
	).toBeVisible();
});

test("supports scope, provider, model, date range, and granularity controls", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await page.getByRole("button", { name: "This node", exact: true }).click();
	await expect(
		page.getByText("Only usage routed through the selected node.")
	).toBeVisible();
	const sourceChart = page.getByTestId("usage-analytics-chart-source");
	await expect(sourceChart.getByText("Local", { exact: true })).toBeVisible();
	await expect(sourceChart.getByText("BYOK", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "15 min", exact: true }).click();
	await expect(
		page.getByText(
			"Requests, tokens, errors, and billed spend at 15 min resolution."
		)
	).toBeVisible();

	await page.getByRole("combobox", { name: "Filter by provider" }).click();
	await page.getByRole("option", { name: "openai", exact: true }).click();
	await expect(page.getByTestId("usage-kpi-requests")).toContainText("3");

	await page.getByRole("combobox", { name: "Filter by model" }).click();
	await page.getByRole("option", { name: "gpt-4.1-mini", exact: true }).click();
	await expect(page.getByTestId("usage-kpi-requests")).toContainText("3");

	await page.getByRole("button", { name: "Choose usage date range" }).click();
	await expect(
		page.getByRole("button", { name: "30 days", exact: true })
	).toBeVisible();
});
