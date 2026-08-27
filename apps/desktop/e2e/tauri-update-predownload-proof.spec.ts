import { expect, test } from "@playwright/test";

const STORY_URL = "/tauri-update-predownload-proof.html";

test("downloads first and waits for explicit Tauri install", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(
		page.getByRole("switch", {
			name: "Download app updates automatically",
		})
	).toBeChecked();
	await expect(page.getByText("Update ready")).toBeVisible();
	await expect(
		page.getByText("v9.9.9 is downloaded and signature-verified.")
	).toBeVisible();
	await expect(page.getByTestId("proof-log")).toContainText(
		"ready → waiting for user"
	);
	await page.screenshot({
		path: "e2e/harness/tauri-update-predownload-ready.png",
		fullPage: true,
	});

	await page.getByRole("button", { name: "Install and restart" }).click();
	await expect(page.getByTestId("proof-status")).toHaveText("Complete");
	await expect(page.getByTestId("proof-log")).toContainText(
		"install → explicit user action"
	);
	await expect(
		page.getByRole("button", { name: "Install and restart" })
	).toBeDisabled();
	await page.screenshot({
		path: "e2e/harness/tauri-update-predownload-proof.png",
		fullPage: true,
	});
});
