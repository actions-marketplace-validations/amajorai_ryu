import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { checkAppUiContract } from "../../../tools/check-app-ui-contract.mjs";

const root = resolve(import.meta.dirname, "../../..");
const { entries } = await checkAppUiContract();
const apps = entries.map((entry) => entry.name);

for (const app of apps) {
	for (const width of [1280, 390]) {
		for (const theme of ["light", "dark"]) {
			test(`${app} renders its built Companion with the ${theme} host theme at ${width}px`, async ({
				page,
			}, testInfo) => {
				await page.setViewportSize({ width, height: 844 });
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.goto(`/${app}/?theme=${theme}`, { waitUntil: "load" });
				try {
					await expect(page.locator("body")).toContainText(/\S/);
				} catch (error) {
					throw new Error(`${app} could not render: ${errors.join("; ")}`, {
						cause: error,
					});
				}
				await page.evaluate(async () => {
					await document.fonts.ready;
					await Promise.all(
						document
							.getAnimations()
							.filter(
								(animation) =>
									animation.timeline === document.timeline &&
									animation.effect?.getComputedTiming().iterations !==
										Number.POSITIVE_INFINITY
							)
							.map((animation) => animation.finished.catch(() => undefined))
					);
				});
				const evidence = await page.evaluate(() => ({
					text: document.body.innerText,
					width: innerWidth,
					scrollWidth: document.documentElement.scrollWidth,
					background: getComputedStyle(document.body).backgroundColor,
					foreground: getComputedStyle(document.body).color,
					theme: document.documentElement.className,
				}));
				await testInfo.attach("render-evidence", {
					body: JSON.stringify({ app, theme, errors, ...evidence }, null, 2),
					contentType: "application/json",
				});
				await page.screenshot({
					path: resolve(
						root,
						`artifacts/ui-design-audit/screenshots/companion-${app}-${theme}${width < 600 ? "-narrow" : ""}.png`
					),
				});
				expect(errors).toEqual([]);
				expect(
					evidence.scrollWidth,
					`${app} page overflow`
				).toBeLessThanOrEqual(evidence.width);
			});
		}
	}
}
