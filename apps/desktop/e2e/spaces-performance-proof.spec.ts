import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Spaces retains rows during refresh and restores a recently used node", async ({
	page,
}) => {
	const calls = { alpha: 0, beta: 0 };
	let held = false;
	let release: () => void = () => undefined;
	let cancelled = 0;
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("requestfailed", (r) => {
		if (r.url().endsWith("/alpha/api/spaces")) {
			cancelled++;
		}
	});
	await page.route("**/*", async (route) => {
		const p = new URL(route.request().url()).pathname;
		if (!/^\/(?:alpha\/|beta\/)?api\//.test(p)) {
			return route.continue();
		}
		const match = p.match(/^\/(alpha|beta)\/api\/spaces$/);
		if (match) {
			const node = match[1] as "alpha" | "beta";
			calls[node]++;
			if (held && node === "alpha") {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			await route
				.fulfill({
					json: {
						spaces: [
							{
								id: "space",
								name: `Research ${node}`,
								description: "Workspace notes",
								document_count: 0,
								created_at: 1_700_000_000,
								updated_at: 1_700_000_000,
								retrieval_mode: "vector",
								visibility: "private",
							},
						],
					},
				})
				.catch(() => undefined);
			return;
		}
		await route.fulfill({
			json: p.endsWith("/api/backups")
				? { destinations: [], policies: [], operations: [] }
				: {},
		});
	});
	await page.goto("/spaces-performance-proof.html");
	await expect(
		page.getByText("Research alpha", { exact: true }).first()
	).toBeVisible();
	expect(calls.alpha).toBe(1);
	held = true;
	await page.getByRole("button", { name: "Refresh list", exact: true }).click();
	await expect.poll(() => calls.alpha).toBe(2);
	await expect(
		page.getByText("Research alpha", { exact: true }).first()
	).toBeVisible();
	await page.getByRole("button", { name: "Beta node", exact: true }).click();
	await expect(
		page.getByText("Research beta", { exact: true }).first()
	).toBeVisible();
	await expect.poll(() => cancelled).toBe(1);
	held = false;
	release();
	await expect(page.getByText("Research alpha", { exact: true })).toHaveCount(
		0
	);
	await page.getByRole("button", { name: "Alpha node", exact: true }).click();
	await expect(
		page.getByText("Research alpha", { exact: true }).first()
	).toBeVisible();
	expect(calls.alpha).toBe(2);
	expect(calls.beta).toBe(1);
	expect(errors).toEqual([]);
	const dir = path.resolve(
		import.meta.dirname,
		"../../../docs/proof/performance-sweep"
	);
	await mkdir(dir, { recursive: true });
	await page.screenshot({
		path: path.join(dir, "spaces-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
	await writeFile(
		path.join(dir, "spaces-reads.json"),
		`${JSON.stringify({ calls, cancelled, rowsRetainedDuringRefresh: true, returnToRecentNodeExtraReads: 0, scope: "Actual SpacesPage/provider against controlled HTTP" }, null, 2)}\n`
	);
});
