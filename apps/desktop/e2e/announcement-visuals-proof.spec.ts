import { expect, test } from "@playwright/test";

const STORY_URL = "/announcement-visuals-proof.html";

test("auto-opens the newest unread announcement with dialog-only artwork", async ({
	page,
}) => {
	await page.goto(STORY_URL);

	await expect(page.getByTestId("announcement-banner-surface")).toBeVisible();
	await expect(
		page
			.getByTestId("announcement-banner-surface")
			.locator("[data-slot='announcement-visual-image']")
	).toHaveCount(0);
	await expect(
		page
			.getByTestId("announcement-banner-surface")
			.locator("[data-slot='announcement-visual-icon']")
	).toHaveCount(0);
	await expect(page.getByTestId("announcement-detail-dialog")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Visual announcements are here" })
	).toBeVisible();
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual']")
	).toBeVisible();
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-icon']")
	).toHaveCount(1);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-app-icon']")
	).toHaveCount(1);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-icon-image']")
	).toHaveCount(0);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-image']")
	).toHaveCount(1);
	await expect(page.getByTestId("proof-status")).toHaveText(
		"Visual announcements are here"
	);
});

test("opens a different admin-authored scene when its banner is clicked", async ({
	page,
}) => {
	await page.goto(STORY_URL);
	await page.getByRole("button", { name: "Done" }).click();

	await page
		.getByRole("button", { name: "Open The orbit palette is separate" })
		.click();
	await expect(page.getByTestId("announcement-detail-dialog")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "The orbit palette is separate" })
	).toBeVisible();
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-image']")
	).toHaveCount(0);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-icon-image']")
	).toHaveCount(0);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-app-icon']")
	).toHaveCount(1);
	await expect(
		page
			.getByTestId("announcement-detail-dialog")
			.locator("[data-slot='announcement-visual-app-icon'] img")
	).toHaveCount(1);
	await expect(page.getByTestId("proof-status")).toHaveText(
		"The orbit palette is separate"
	);
});
