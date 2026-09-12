import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");

for (const [theme, width] of [
	["light", 1280],
	["dark", 390],
] as const) {
	test(`renders the compact dead-logo crash fallback in ${theme}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 780 });
		await page.goto(`/crash-boundary-proof.html?theme=${theme}`);
		await page.waitForSelector('body[data-harness-ready="1"]');

		await expect(
			page.getByText("Something broke", { exact: true })
		).toBeVisible();
		await expect(
			page.getByText("Try again or reload.", { exact: true })
		).toBeVisible();
		await expect(
			page.locator('[data-expressive-expression="dead"]')
		).toBeVisible();
		await expect(page.locator('[data-expressive-eye-shape="x"]')).toHaveCount(
			2
		);
		await expect(
			page.getByRole("button", { name: "Try again", exact: true })
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Reload", exact: true })
		).toBeVisible();

		const evidence = await page.evaluate(() => ({
			bodyText: document.body.innerText,
			height: innerHeight,
			horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
			width: innerWidth,
		}));
		await testInfo.attach("render-evidence", {
			body: JSON.stringify({ theme, ...evidence }, null, 2),
			contentType: "application/json",
		});
		await page.screenshot({
			path: resolve(
				root,
				`artifacts/ui-design-audit/screenshots/crash-boundary-${theme}.png`
			),
		});

		expect(evidence.horizontalOverflow).toBe(false);
	});
}
