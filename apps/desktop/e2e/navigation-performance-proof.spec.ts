import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const baseline = Boolean(process.env.RYU_NAV_BASELINE);
const proofDir = path.resolve(
	import.meta.dirname,
	"../../../docs/proof/navigation-performance"
);
test("warm switching avoids unrelated route renders and preserves working state", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto("/navigation-performance-proof.html");
	await expect(page.locator("[data-workspace]")).toHaveCount(12);
	const draft = page.getByRole("textbox", { name: "Working draft" });
	await draft.fill("Keep this draft across tab switches");
	await page
		.locator("[data-scroll]")
		.first()
		.evaluate((element) => {
			element.scrollTop = 480;
		});
	const before = await page
		.locator("[data-workspace]")
		.evaluateAll((elements) =>
			elements.map((element) => Number(element.getAttribute("data-renders")))
		);
	const timings: number[] = [];
	for (let index = 0; index < 24; index++) {
		const title = index % 2 === 0 ? "Workspace 2" : "Workspace 1";
		// Time the real click handler through the next painted frame. Avoid including
		// Playwright locator/IPC overhead in the navigation measurement.
		const elapsed = await page.evaluate(async (name) => {
			const button = Array.from(document.querySelectorAll("nav button")).find(
				(item) => item.textContent === name
			);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error("Missing tab button");
			}
			const start = performance.now();
			button.click();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			return performance.now() - start;
		}, title);
		timings.push(elapsed);
		await expect(
			page.getByRole("heading", { name: title, exact: true })
		).toBeVisible();
	}
	const after = await page
		.locator("[data-workspace]")
		.evaluateAll((elements) =>
			elements.map((element) => Number(element.getAttribute("data-renders")))
		);
	const unrelatedRenders = after
		.slice(2)
		.reduce((sum, count, index) => sum + count - (before[index + 2] ?? 0), 0);
	if (!baseline) {
		expect(unrelatedRenders).toBe(0);
	}
	await expect(draft).toHaveValue("Keep this draft across tab switches");
	expect(
		await page
			.locator("[data-scroll]")
			.first()
			.evaluate((element) => element.scrollTop)
	).toBe(480);
	await page.getByRole("button", { name: "Find message", exact: true }).click();
	await expect(page.locator("[data-request]").first()).toHaveText("message-42");
	await page.getByRole("button", { name: "Mark busy", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Workspace 1", exact: true })
	).toBeVisible();
	await page.getByRole("button", { name: "Open page", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "New workspace", exact: true })
	).toBeVisible();
	await expect(page.locator("[data-workspace]")).toHaveCount(13);
	await page.getByRole("button", { name: "Workspace 1", exact: true }).click();
	await page
		.getByRole("button", { name: "Unload last tab", exact: true })
		.click();
	await expect(page.locator("[data-workspace]")).toHaveCount(12);
	await page
		.getByRole("button", { name: "New workspace", exact: true })
		.click();
	await expect(page.locator("[data-workspace]")).toHaveCount(13);
	await expect(
		page.getByRole("heading", { name: "New workspace", exact: true })
	).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
	const saved = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("ryu_session_tabs") ?? "{}")
	);
	expect(saved.tabs[saved.activeIndex].title).toBe("New workspace");
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	const sorted = [...timings].sort((a, b) => a - b);
	await writeFile(
		path.join(proofDir, baseline ? "baseline.json" : "after.json"),
		JSON.stringify(
			{
				scenario:
					"12 mounted routes, 160 rows per route, 24 warm switches; component harness",
				unrelatedRenders,
				timings,
				medianMs: sorted[12],
				p95Ms: sorted[22],
				errors,
			},
			null,
			2
		)
	);
	if (!baseline) {
		await page.screenshot({
			path: path.join(proofDir, "navigation-completed.png"),
			fullPage: true,
		});
	}
});
