import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("imports a CSV and preserves completed file and Composio history", async ({
	page,
}) => {
	await page.goto("/spaces-import-proof.html");
	await page.getByRole("tab", { name: "Import" }).click();

	await expect(
		page.getByRole("heading", { name: "Import", exact: true })
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Ingest a document" })
	).toBeHidden();
	await expect(page.getByText("File-based imports")).toBeVisible();
	await expect(page.getByText("Third-party imports")).toBeVisible();
	await expect(page.getByText("customer-research.csv")).toBeVisible();
	await expect(
		page.getByText("Open GitHub issues", { exact: true }).first()
	).toBeVisible();
	await expect(page.getByLabel("Connected app")).toContainText("GitHub");
	await expect(page.getByLabel("Read action")).toContainText(
		"List repository issues"
	);
	await page.getByLabel("Read action").click();
	await expect(
		page.getByRole("option", { name: "List repository issues" })
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: "List and mark notifications" })
	).toHaveCount(0);
	await page.screenshot({
		path: "e2e/proof/spaces-import-readonly-actions-proof.png",
	});
	await page.getByRole("option", { name: "List repository issues" }).click();

	await page.getByLabel("Spreadsheets files").setInputFiles({
		name: "fresh-leads.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,score\nAda,9\nLin,8\nSam,7\n"),
	});
	await expect(page.getByText("fresh-leads.csv")).toBeVisible({
		timeout: 10_000,
	});
	await expect(page.getByText("3 items")).toBeVisible();

	await page.getByRole("button", { name: "Open Fresh leads" }).click();
	await expect(page.getByTestId("opened-document")).toHaveText(
		"database:Fresh leads"
	);

	await page.getByLabel("Owner").fill("amajorai");
	await page.getByLabel("Repository").fill("ryu");
	await page.getByLabel("Title").fill("Ryu GitHub issues");
	await page.getByRole("button", { name: "Import from GitHub" }).click();
	await expect(
		page.getByText("Ryu GitHub issues", { exact: true }).first()
	).toBeVisible({ timeout: 10_000 });
	await expect(page.getByText("17 items")).toBeVisible();
	await page.getByRole("button", { name: "Open Ryu GitHub issues" }).click();
	await expect(page.getByTestId("opened-document")).toHaveText(
		"database:Ryu GitHub issues"
	);
	await page.getByRole("tabpanel", { name: "Import" }).evaluate((panel) => {
		panel.scrollTop = 0;
	});

	await page.screenshot({
		path: "e2e/proof/spaces-import-proof.png",
		fullPage: true,
	});
});
