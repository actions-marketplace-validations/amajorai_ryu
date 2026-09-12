import { expect, test } from "@playwright/test";

test("fuzzy local results support facets and keyboard selection", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/extension-local-search-proof.html");
	await expect(page.getByTestId("local-search-proof")).toBeVisible();

	const input = page.getByLabel("Search, type a URL, or ask Ryu…");
	await input.fill("browzer extenson");
	await expect(
		page.getByRole("option", { name: /Rust browser extension guide/ })
	).toBeVisible();
	await expect(page.getByTestId("local-search-facets")).toContainText(
		"conversation:1"
	);

	await input.press("ArrowDown");
	await expect(
		page.getByRole("option", { name: /Rust browser extension guide/ })
	).toHaveAttribute("aria-selected", "true");
	await input.press("Enter");
	await expect(page.getByTestId("local-search-selection")).toHaveText(
		"Selected: Rust browser extension guide (conversation)"
	);

	await input.fill("rust");
	await expect(page.getByRole("option", { name: /Rust docs/ })).toBeVisible();
	await expect(
		page.getByRole("option", { name: /Rust browser extension guide/ })
	).toBeVisible();
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("extension-local-search-proof.png"),
	});
	await expect(page.locator("[role=listbox]")).toBeVisible();
	expect(errors).toEqual([]);
});

test("local results fit the narrow browser surface", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/extension-local-search-proof.html");
	const input = page.getByLabel("Search, type a URL, or ask Ryu…");
	await input.fill("rust");
	await expect(page.getByRole("option", { name: /Rust docs/ })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
		.toBeLessThanOrEqual(391);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("extension-local-search-narrow-proof.png"),
	});
});
