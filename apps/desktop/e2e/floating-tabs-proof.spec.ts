import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("proves the default and morphing tab appearances", async ({ page }) => {
	await page.goto("/floating-tabs-proof.html");

	const toggle = page.getByTestId("floating-tabs-toggle");
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(page.getByTestId("proof-default")).toHaveText(
		"Floating tabs On"
	);
	await expect(page.getByTestId("proof-status")).toHaveAttribute(
		"data-proof-status",
		"pass"
	);

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('[data-tab-appearance="morphing"]')).toHaveCount(3);
	await expect(page.locator('[data-tab-surface="morphing"]')).toHaveCount(1);
	await expect(page.getByTestId("proof-surface")).toHaveText(
		"1 active shared surface"
	);

	await page.getByRole("button", { name: "Drafts" }).click();
	await expect(page.locator('[data-tab-surface="morphing"]')).toHaveCount(1);
});
