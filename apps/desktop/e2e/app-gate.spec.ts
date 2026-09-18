import path from "node:path";
import { expect, type Route, test } from "@playwright/test";

const roster = (enabled: boolean) => ({
	apps: [
		{
			id: "@ryu/meetings",
			name: "Meetings",
			enabled,
			installed: true,
			version: "1.0.0",
			capabilities: [],
			runnables: [],
			permission_grants: [],
		},
	],
});
test("app gates reuse the shared roster and stop Meetings work on disable", async ({
	page,
	request,
	browserName,
}) => {
	const initialStream = await (
		await request.get("/proof-meeting-stream-state")
	).json();
	let reads = 0;
	let enabled = false;
	let seeds = 0;
	let streams = 0;
	const cancelled: string[] = [];
	page.on("requestfailed", (request) =>
		cancelled.push(new URL(request.url()).pathname)
	);
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		if (!url.pathname.startsWith("/api/")) {
			return route.continue();
		}
		if (url.pathname === "/api/plugins") {
			reads += 1;
			return route.fulfill({ json: roster(enabled) });
		}
		if (url.pathname.endsWith("/enable") || url.pathname.endsWith("/disable")) {
			enabled = url.pathname.endsWith("/enable");
			return route.fulfill({
				json: {
					app: { id: "@ryu/meetings", enabled, installed: true, config: {} },
				},
			});
		}
		if (url.pathname === "/api/meetings") {
			seeds += 1;
			return;
		}
		if (url.pathname === "/api/meetings/stream") {
			streams += 1;
			return route.continue();
		}
		return route.fulfill({ json: {} });
	});
	await page.goto("/app-gate-proof.html");
	await expect(
		page.getByText("Enable the Meetings app", { exact: true })
	).toBeVisible();
	expect(reads).toBe(1);
	expect(seeds).toBe(0);
	expect(streams).toBe(0);
	await page.getByRole("button", { name: "Enable", exact: true }).click();
	await expect.poll(() => seeds).toBe(1);
	await expect.poll(() => streams).toBe(1);
	await expect(page.getByTestId("recording-state")).toHaveText(
		"Meeting state: recording"
	);
	await page
		.getByRole("button", { name: "Disable Meetings", exact: true })
		.click();
	await expect.poll(() => cancelled.includes("/api/meetings")).toBe(true);
	await expect
		.poll(() => cancelled.includes("/api/meetings/stream"))
		.toBe(true);
	await expect
		.poll(
			async () =>
				(await (await request.get("/proof-meeting-stream-state")).json()).closed
		)
		.toBe(initialStream.closed + 1);
	await expect(page.getByTestId("recording-state")).toHaveText(
		"Meeting state: idle"
	);
	await expect(
		page.getByText("Enable the Meetings app", { exact: true })
	).toBeVisible();
	expect(seeds).toBe(1);
	expect(streams).toBe(1);
	await page.screenshot({
		path: path.resolve(
			import.meta.dirname,
			browserName === "webkit"
				? "../../../docs/proof/performance-sweep/app-gate-webkit-completed.png"
				: "../../../docs/proof/performance-sweep/app-gate-completed.png"
		),
		fullPage: true,
		animations: "disabled",
	});
});
test("unknown identity rosters stay closed and obsolete shared reads abort", async ({
	page,
}) => {
	const reads: Route[] = [];
	let cancelled = 0;
	let meetingReads = 0;
	page.on("requestfailed", (request) => {
		if (new URL(request.url()).pathname === "/api/plugins") {
			cancelled += 1;
		}
	});
	await page.route("**/api/**", async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (!pathname.startsWith("/api/")) {
			return route.continue();
		}
		if (pathname === "/api/plugins") {
			reads.push(route);
			return;
		}
		if (pathname.startsWith("/api/meetings")) {
			meetingReads += 1;
		}
		return route.fulfill({ json: {} });
	});
	await page.goto("/app-gate-proof.html");
	await expect.poll(() => reads.length).toBe(1);
	expect(meetingReads).toBe(0);
	await page
		.getByRole("button", { name: "Rotate identity", exact: true })
		.click();
	await expect.poll(() => reads.length).toBe(2);
	await expect.poll(() => cancelled).toBe(1);
	await reads[1].fulfill({
		status: 503,
		json: { error: "Fixture unavailable" },
	});
	await expect(page.getByRole("status")).toHaveText("Apps unavailable");
	expect(meetingReads).toBe(0);
	await page
		.getByRole("button", { name: "Unmount runtime", exact: true })
		.click();
	await expect(page.getByText("Runtime closed", { exact: true })).toBeVisible();
});
