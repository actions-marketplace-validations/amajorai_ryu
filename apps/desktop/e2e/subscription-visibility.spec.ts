import path from "node:path";
import { expect, test } from "@playwright/test";

test("retained usage page stays quiet while hidden and reuses fresh account data", async ({
	page,
}) => {
	let reads = 0;
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/api/**", async (route) => {
		if (!new URL(route.request().url()).pathname.startsWith("/api/")) {
			return route.continue();
		}
		if (
			!new URL(route.request().url()).pathname.endsWith(
				"/accounts/personal/usage"
			)
		) {
			return route.fulfill({ json: {} });
		}
		reads += 1;
		await route.fulfill({
			json: {
				agent_id: "codex",
				available: true,
				engine: "codex",
				plan: "Pro",
				windows: [
					{ label: "Session", used_percent: 25, window_seconds: 18_000 },
				],
				meters: [],
			},
		});
	});
	await page.goto("/subscription-visibility-proof.html");
	await expect(
		page.getByRole("button", { name: "Show usage", exact: true })
	).toBeVisible();
	expect(reads).toBe(0);
	await page.getByRole("button", { name: "Show usage", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "Subscription usage" })
	).toBeVisible();
	await expect(page.getByText("Personal", { exact: true })).toBeVisible();
	await expect.poll(() => reads).toBe(1);
	await expect(
		page.getByRole("progressbar", { name: "Session: 75% left" })
	).toBeVisible();
	await page.getByRole("button", { name: "Hide usage", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "Subscription usage" })
	).toBeHidden();
	await page.getByRole("button", { name: "Show usage", exact: true }).click();
	await expect(page.getByText("Personal", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("progressbar", { name: "Session: 75% left" })
	).toBeVisible();
	expect(reads).toBe(1);
	expect(errors).toEqual([]);
	await page.screenshot({
		path: path.resolve(
			import.meta.dirname,
			"../../../docs/proof/performance-sweep/subscription-visibility-completed.png"
		),
		fullPage: true,
		animations: "disabled",
	});
});
