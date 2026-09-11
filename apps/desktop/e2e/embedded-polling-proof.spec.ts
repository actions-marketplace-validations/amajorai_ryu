import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const proofDir = path.resolve(
	import.meta.dirname,
	"../../../docs/proof/performance-sweep"
);
test("CSS-hidden sandboxed companions pause shared polls and resume without remounting", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await expect(
		frame.getByRole("heading", { name: "Warmup", exact: true })
	).toBeVisible();
	const reads = async () =>
		Number(await page.getByTestId("reads").textContent());
	await frame.getByLabel("Ping message").fill("Draft kept across tabs");
	await page.clock.fastForward(31_000);
	await expect.poll(reads).toBeGreaterThan(3);
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page
		.getByRole("button", { name: "Inspect visibility", exact: true })
		.click();
	await expect(page.getByTestId("visibility")).toHaveText("false/visible");
	const hiddenReads = await reads();
	await page.clock.fastForward(61_000);
	expect(await reads()).toBe(hiddenReads);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect.poll(reads).toBeGreaterThan(hiddenReads);
	await expect(
		frame.getByRole("heading", { name: "Warmup", exact: true })
	).toBeVisible();
	await expect(frame.getByLabel("Ping message")).toHaveValue(
		"Draft kept across tabs"
	);
	await frame
		.getByRole("button", { name: "Close panels", exact: true })
		.click();
	await page.waitForTimeout(150);
	const closedReads = await reads();
	await page.clock.fastForward(61_000);
	expect(await reads()).toBe(closedReads);
	await frame.getByRole("button", { name: "Open panels", exact: true }).click();
	await expect.poll(reads).toBeGreaterThan(closedReads);
	await page
		.getByRole("button", { name: "Inspect visibility", exact: true })
		.click();
	await expect(page.getByTestId("visibility")).toHaveText("true/visible");
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "embedded-companion-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
	expect(errors).toEqual([]);
	await writeFile(
		path.join(proofDir, "embedded-companion-polling.json"),
		`${JSON.stringify(
			{
				sandbox: "allow-scripts without same-origin",
				hiddenDocumentVisibility: "visible",
				hiddenAutomaticReads: 0,
				resumedWithoutRemount: true,
				closedAutomaticReads: 0,
			},
			null,
			2
		)}\n`
	);
});

test("production Warmup bundle retains drafts while hidden polls stop", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-warmup-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let proofReads=0;function result(value){parent.postMessage({kind:"proof-read",reads:++proofReads},"*");return Promise.resolve(value)}window.ryu={warmup:{detect:()=>result({tz:"UTC",agents:[{id:"sample",name:"Codex",available:true,plan:"Subscription",reason:null,models:[],windows:[{label:"Current window",usedPercent:12,resetsAt:null,windowSeconds:18000}]}]}),list:()=>result([])},catalog:{snapshot:()=>result(null)}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await expect(
		frame.getByRole("heading", { name: "Warmup", exact: true })
	).toBeVisible();
	await frame.getByLabel("Ping message").fill("Draft kept across tabs");
	const reads = async () =>
		Number(await page.getByTestId("reads").textContent());
	await page.clock.fastForward(31_000);
	await expect.poll(reads).toBeGreaterThan(3);
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	const hiddenReads = await reads();
	await page.clock.fastForward(61_000);
	expect(await reads()).toBe(hiddenReads);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect.poll(reads).toBeGreaterThan(hiddenReads);
	await expect(frame.getByLabel("Ping message")).toHaveValue(
		"Draft kept across tabs"
	);
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "embedded-companion-production.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Inbox waits for its refreshed decision list and pauses inactive reads", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-approvals-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0;let decided=false;function track(value){parent.postMessage({kind:"proof-read",reads:++reads},"*");return value}function approval(){return {id:"proof",kind:"tool_call",title:"Review generated report",summary:"Controlled local approval",created_at:"2026-09-11T00:00:00Z",risk_tags:[],status:decided?"approved":"pending"}}window.ryu={approvals:{list:async()=>{const rows=track([approval()]);if(decided)await new Promise(r=>{const done=e=>{if(e.data!=="proof-release-decision")return;removeEventListener("message",done);r()};addEventListener("message",done)});return rows},approve:async()=>{decided=true;document.body.dataset.proofDecided="true";return approval()}},quests:{list:async()=>track([])},notifications:{list:async()=>[],appIcons:async()=>({})},suggestions:{list:async()=>[]}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	const approve = frame.getByRole("button", { name: /Approve/ });
	await expect(approve).toBeVisible();
	const reads = async () =>
		Number(await page.getByTestId("reads").textContent());
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	const hiddenReads = await reads();
	await page.clock.fastForward(61_000);
	expect(await reads()).toBe(hiddenReads);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect.poll(reads).toBeGreaterThan(hiddenReads);
	await approve.press("Enter");
	await expect(frame.locator("body")).toHaveAttribute(
		"data-proof-decided",
		"true"
	);
	await expect(approve).toBeDisabled();
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("proof-release-decision", "*")
		);
	await expect(approve).toHaveCount(0);
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "inbox-polling-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Inbox refreshes notifications without repeating icon downloads", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-approvals-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let lists=0,icons=0;window.ryu={approvals:{list:async()=>[]},quests:{list:async()=>[]},suggestions:{list:async()=>[]},notifications:{list:async()=>{document.body.dataset.notificationReads=String(++lists);return [{id:"notice",title:"Build complete",body:"Workspace is ready",created_at:"2026-09-12T00:00:00Z",level:"info",user_id:"fixture",ack_required:false,acked:false,source_app_id:"com.test.sender"}]},appIcons:async()=>{document.body.dataset.iconReads=String(++icons);return {"com.test.sender":{name:"Workspace",glyph:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' rx='6' fill='%230088ff'/%3E%3C/svg%3E",background:null}}}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await expect(
		frame.getByText("Build complete", { exact: true })
	).toBeVisible();
	await expect(frame.locator("body")).toHaveAttribute("data-icon-reads", "1");
	await page.clock.fastForward(16_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-notification-reads",
		"2"
	);
	await expect(frame.locator("body")).toHaveAttribute("data-icon-reads", "1");
	await frame
		.getByRole("button", { name: "Refresh", exact: true })
		.press("Enter");
	await expect(frame.locator("body")).toHaveAttribute(
		"data-notification-reads",
		"3"
	);
	await expect(frame.locator("body")).toHaveAttribute("data-icon-reads", "2");
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page.clock.fastForward(61_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-notification-reads",
		"3"
	);
	await expect(frame.locator("body")).toHaveAttribute("data-icon-reads", "2");
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute(
		"data-notification-reads",
		"4"
	);
	await expect(
		frame.getByText("Build complete", { exact: true })
	).toBeVisible();
	const titleBox = await frame
		.getByText("Build complete", { exact: true })
		.boundingBox();
	const bodyBox = await frame
		.getByText("Workspace is ready", { exact: true })
		.boundingBox();
	expect(titleBox).not.toBeNull();
	expect(bodyBox).not.toBeNull();
	expect(bodyBox!.y).toBeGreaterThan(titleBox!.y);
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "notifications-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Quests pauses list polls and preserves typing ahead of scratchpad load", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-quests-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0;window.ryu={quests:{list:async()=>{document.body.dataset.questReads=String(++reads);return []},scratchpad:()=>new Promise(resolve=>{const ready=e=>{if(e.data!=="release-scratchpad")return;removeEventListener("message",ready);resolve("Old stored text")};addEventListener("message",ready)}),setScratchpad:async({text})=>{document.body.dataset.savedScratchpad=text}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame.getByRole("button", { name: /Scratchpad/ }).click();
	await frame
		.getByRole("textbox", { name: "Scratchpad", exact: true })
		.fill("Keep my new draft");
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-scratchpad", "*")
		);
	await expect(
		frame.getByRole("textbox", { name: "Scratchpad", exact: true })
	).toHaveValue("Keep my new draft");
	await page.clock.fastForward(1000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-saved-scratchpad",
		"Keep my new draft"
	);
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	const before = await frame.locator("body").getAttribute("data-quest-reads");
	await page.clock.fastForward(31_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-quest-reads",
		before!
	);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect
		.poll(async () =>
			Number(await frame.locator("body").getAttribute("data-quest-reads"))
		)
		.toBeGreaterThan(Number(before));
	await expect(
		frame.getByRole("textbox", { name: "Scratchpad", exact: true })
	).toHaveValue("Keep my new draft");
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "quests-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});
