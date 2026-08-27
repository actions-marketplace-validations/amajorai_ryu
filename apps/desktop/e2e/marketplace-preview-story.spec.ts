import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("keeps the Marketplace preview prompt-first and details collapsed", async ({
	page,
}, testInfo) => {
	await page.goto("/marketplace-preview-story.html");
	await page.getByTestId("open-marketplace-preview").click();

	await expect(
		page.getByRole("banner").getByRole("heading", { name: "Research Desk" })
	).toBeVisible();
	await expect(page.getByTestId("marketplace-prompt-banner")).toBeVisible();
	await expect(
		page.getByText("Try Research Desk", { exact: true })
	).not.toBeVisible();
	await expect(page.getByText("@Research Desk", { exact: true })).toHaveCount(
		3
	);
	const widths = await page
		.getByTestId("marketplace-prompt-banner")
		.getByRole("button")
		.first()
		.evaluate((button) => {
			const banner = button.closest<HTMLElement>(
				'[data-testid="marketplace-prompt-banner"]'
			);
			return {
				bannerWidth: banner?.getBoundingClientRect().width ?? 0,
				rowWidth: button.getBoundingClientRect().width,
			};
		});
	expect(widths.rowWidth).toBeLessThan(widths.bannerWidth - 32);
	await expect(
		page.getByRole("button", { name: "More details" })
	).toHaveAttribute("aria-expanded", "false");
	await expect(
		page.getByText("Information", { exact: true })
	).not.toBeVisible();
	await expect(
		page.getByText("research-search", { exact: true })
	).not.toBeVisible();

	const palette = await page
		.getByTestId("marketplace-prompt-banner")
		.getAttribute("data-palette");
	expect(palette).toContain("#3658d4");

	await page.screenshot({
		path: testInfo.outputPath("marketplace-preview-collapsed.png"),
	});

	await page.getByRole("button", { name: "More details" }).click();
	await expect(
		page.getByRole("button", { name: "More details" })
	).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByText("Information", { exact: true })).toBeVisible();
	await expect(
		page.getByText("research-search", { exact: true })
	).toBeVisible();

	await page.screenshot({
		path: testInfo.outputPath("marketplace-preview-details.png"),
	});
});
