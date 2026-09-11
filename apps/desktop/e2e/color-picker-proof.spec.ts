import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("shows the shared panel and persists a recent swatch", async ({
	page,
}) => {
	await page.goto("/color-picker-proof.html");
	await page.evaluate(() =>
		localStorage.removeItem("ryu:color-picker:recent-colors")
	);
	await page.reload();

	await expect(
		page.getByRole("button", { name: "Accent color", exact: true })
	).toBeVisible();
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.first()
			.getByRole("group", { name: "Hue", exact: true })
			.getByRole("slider")
	).toBeVisible();
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.first()
			.getByRole("group", { name: "Alpha", exact: true })
			.getByRole("slider")
	).toBeVisible();
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.first()
			.getByRole("group", { name: "Swatches", exact: true })
	).toBeVisible();

	await page
		.getByRole("button", { name: "Select swatches #FF3B30", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Accent color", exact: true })
	).toContainText("#FF3B30");

	await page.reload();
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.last()
			.getByRole("group", { name: "Recent colors", exact: true })
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page
		.getByRole("button", { name: "Surface color", exact: true })
		.click();
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.last()
			.getByRole("group", { name: "Recent colors", exact: true })
	).toBeVisible();
	await expect(
		page.locator('[role="dialog"]:visible').last().getByRole("button", {
			name: "Select recent colors #FF3B30",
			exact: true,
		})
	).toBeVisible();
	await page.waitForTimeout(400);

	await page.screenshot({
		fullPage: true,
		path: "/tmp/ryu-color-picker-recent-colors-proof.png",
	});

	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await expect(
		page
			.locator('[role="dialog"]:visible')
			.last()
			.getByRole("group", { name: "Recent colors", exact: true })
	).toBeVisible();
	await page.waitForTimeout(400);
	await page.screenshot({
		fullPage: true,
		path: "/tmp/ryu-color-picker-recent-colors-proof-dark.png",
	});

	await page.setViewportSize({ width: 390, height: 844 });
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	expect(overflow).toBe(false);
	await expect(
		page.getByRole("button", { name: "Surface color", exact: true })
	).toBeVisible();
	await page.waitForTimeout(400);
	await page.screenshot({
		fullPage: true,
		path: "/tmp/ryu-color-picker-recent-colors-proof-mobile.png",
	});
});
