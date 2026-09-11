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
