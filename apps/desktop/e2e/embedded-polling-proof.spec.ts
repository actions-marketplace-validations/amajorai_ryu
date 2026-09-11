import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { newProject } from "../../../apps-store/video-studio/shared/project.ts";

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

test("production Broadcast keeps its draft and selection while hidden reads stop", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-broadcast-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0;window.ryu={chat:{list:async()=>{document.body.dataset.broadcastReads=String(++reads);return [{id:"chat-a",title:"Planning",agent_id:"agent-a",message_count:3,run_status:"running",archived:false}]},send:async()=>{document.body.dataset.sent="true";throw Error("Sending is not part of this read-only proof")}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame.getByRole("tab", { name: /Selected/ }).click();
	await frame.getByRole("checkbox", { name: /^Select Planning/ }).check();
	await frame
		.getByRole("textbox", { name: "Broadcast message", exact: true })
		.fill("Draft only — do not send");
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page.clock.fastForward(31_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-broadcast-reads",
		"1"
	);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute(
		"data-broadcast-reads",
		"2"
	);
	await expect(
		frame.getByRole("checkbox", { name: /^Select Planning/ })
	).toBeChecked();
	await expect(
		frame.getByRole("textbox", { name: "Broadcast message", exact: true })
	).toHaveValue("Draft only — do not send");
	expect(await frame.locator("body").getAttribute("data-sent")).toBeNull();
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "broadcast-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Monitors avoids overlapping details and rejects a previous selection", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-monitors-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let aReads=0;let held="a";addEventListener("message",e=>{if(e.data==="hold-monitor-b")held="b"});window.ryu={monitors:{list:async()=>["a","b"].map(id=>({id,name:"Monitor "+id.toUpperCase(),url:"https://example.com/"+id,backend:"http",check:{type:"uptime"},interval:"5m",enabled:true,notify:[],created_at:"2026-09-12T00:00:00Z",updated_at:"2026-09-12T00:00:00Z"})),snapshots:async({id})=>{if(id==="a")document.body.dataset.aReads=String(++aReads);if(id===held){await new Promise(resolve=>{const done=e=>{if(e.data!=="release-monitor-"+id)return;removeEventListener("message",done);resolve()};addEventListener("message",done)})}return []},alerts:async({id})=>[{id:1,monitor_id:id,monitor_name:"Monitor "+id.toUpperCase(),title:"Alert "+id.toUpperCase(),message:"Controlled monitor detail",kind:"uptime",acknowledged:false,created_at:"2026-09-12T00:00:00Z"}]}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame.getByRole("button", { name: /Monitor A/ }).press("Enter");
	await expect(frame.locator("body")).toHaveAttribute("data-a-reads", "1");
	await page.clock.fastForward(16_000);
	await expect(frame.locator("body")).toHaveAttribute("data-a-reads", "1");
	await frame.getByRole("button", { name: /Monitor B/ }).press("Enter");
	await expect(frame.getByText("Alert B", { exact: true })).toBeVisible();
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-monitor-a", "*")
		);
	await page.clock.fastForward(1);
	await expect(frame.getByText("Alert A", { exact: true })).toHaveCount(0);
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("hold-monitor-b", "*")
		);
	await frame.getByRole("button", { name: /Monitor A/ }).press("Enter");
	await expect(frame.getByText("Alert A", { exact: true })).toBeVisible();
	await frame.getByRole("button", { name: /Monitor B/ }).press("Enter");
	await expect(frame.getByText("Alert A", { exact: true })).toHaveCount(0);
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-monitor-b", "*")
		);
	await expect(frame.getByText("Alert B", { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "monitors-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Fine-tuning coalesces slow job reads and preserves configuration while hidden", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-finetune-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0;window.ryu={finetune:{capability:async()=>({can_train_local:true,gpu:"Local GPU"}),adapters:async()=>({adapters:[]}),list:async()=>{document.body.dataset.jobReads=String(++reads);if(reads===1)await new Promise(resolve=>{const done=e=>{if(e.data!=="release-jobs")return;removeEventListener("message",done);resolve()};addEventListener("message",done)});return {jobs:[]}},start:async()=>{document.body.dataset.started="true";throw Error("No training starts in this proof")}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame
		.getByRole("textbox", { name: "Base model id", exact: true })
		.fill("unsloth/llama-3-8b-bnb-4bit");
	await frame
		.getByRole("textbox", { name: "Output adapter name", exact: true })
		.fill("My saved draft");
	await page.clock.fastForward(13_000);
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "1");
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-jobs", "*")
		);
	await page.clock.fastForward(1);
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page.clock.fastForward(21_000);
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "1");
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "2");
	await expect(
		frame.getByRole("textbox", { name: "Output adapter name", exact: true })
	).toHaveValue("My saved draft");
	expect(await frame.locator("body").getAttribute("data-started")).toBeNull();
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "finetune-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Fine-tuning keeps live progress and refreshes once on repeated terminal frames", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const html = await readFile(
		"/tmp/ryu-finetune-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let lists=0,adapters=0;window.ryu={context:{view:"history"},finetune:{capability:async()=>({can_train_local:true,gpu:"Local GPU"}),adapters:async()=>{document.body.dataset.adapterReads=String(++adapters);return {adapters:[]}},list:async()=>{document.body.dataset.jobReads=String(++lists);return {jobs:[{id:"run-a",output_name:"Training preview",state:"running",step:10,max_steps:100}]}},stream:async(_input,hooks)=>{document.body.dataset.streams="1";hooks.signal.addEventListener("abort",()=>{document.body.dataset.streamAborted="true"});addEventListener("message",e=>{if(e.data==="progress")hooks.onFrame(JSON.stringify({step:50}));if(e.data==="terminal"){for(let i=0;i<4;i++)hooks.onFrame(JSON.stringify({state:"succeeded",step:100}))}})}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.goto("/embedded-polling-proof.html");
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame.getByRole("button", { name: /Training preview/ }).press("Enter");
	await expect(frame.locator("body")).toHaveAttribute("data-streams", "1");
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("progress", "*")
		);
	await page.clock.fastForward(9000);
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "1");
	await expect(frame.getByText("50 / 100", { exact: true })).toHaveCount(1);
	expect(
		await frame.locator("body").getAttribute("data-stream-aborted")
	).toBeNull();
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "2");
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("terminal", "*")
		);
	await expect(frame.locator("body")).toHaveAttribute("data-job-reads", "3");
	await expect(frame.locator("body")).toHaveAttribute(
		"data-adapter-reads",
		"2"
	);
	await expect(frame.getByText("100 / 100", { exact: true })).toBeVisible();
	expect(errors).toEqual([]);
	await mkdir(proofDir, { recursive: true });
	await page.screenshot({
		path: path.join(proofDir, "finetune-progress-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Video Studio retains a newly queued export against an old poll and pauses hidden reads", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const project = newProject("Performance preview");
	project.titles.push({
		id: crypto.randomUUID(),
		start: 0,
		end: 5,
		text: "Ryu Video Studio",
		x: 0.5,
		y: 0.5,
		fontSize: 0.08,
		color: "#ffffff",
		fadeIn: 0,
		fadeOut: 0,
		animation: "fade",
	});
	const html = await readFile(
		"/tmp/ryu-video-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0;const project=${JSON.stringify(project)};const job={id:"render-preview",projectId:project.id,revision:0,status:"running",progress:0.2};window.ryu={app:{request:async({path,method})=>{if(path==="/projects")return {projects:[project]};if(path==="/assets")return {assets:[]};if(path==="/renders"){document.body.dataset.renderReads=String(++reads);if(reads===1){await new Promise(resolve=>{const done=e=>{if(e.data!=="release-renders")return;removeEventListener("message",done);resolve()};addEventListener("message",done)});return {jobs:[]}}return {jobs:[{...job,status:"completed",progress:1}]}}if(path.endsWith("/render")&&method==="POST"){document.body.dataset.exportRequests="1";return job}throw Error("Unexpected fixture request "+path)}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.setViewportSize({ width: 1600, height: 1200 });
	await page.goto("/embedded-polling-proof.html");
	await page.locator("main").evaluate((element) => {
		element.style.maxWidth = "none";
	});
	await page.locator("iframe").evaluate((element) => {
		element.style.height = "950px";
	});
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await expect(
		frame.getByRole("button", { name: "Export video", exact: true })
	).toBeEnabled();
	await page.clock.fastForward(6000);
	await expect(frame.locator("body")).toHaveAttribute("data-render-reads", "1");
	await frame
		.getByRole("button", { name: "Export video", exact: true })
		.press("Enter");
	await expect(
		frame.getByText("Encoding video…", { exact: true })
	).toBeVisible();
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-renders", "*")
		);
	await page.clock.fastForward(1);
	await expect(
		frame.getByText("Encoding video…", { exact: true })
	).toBeVisible();
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page.clock.fastForward(10_000);
	await expect(frame.locator("body")).toHaveAttribute("data-render-reads", "1");
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute("data-render-reads", "2");
	await expect(frame.getByRole("status")).toHaveText(
		"Export completed. Your video is ready to download."
	);
	await expect(
		frame.getByRole("button", { name: "Download MP4", exact: true })
	).toBeVisible();
	await frame
		.getByRole("button", { name: "Play timeline", exact: true })
		.press("Enter");
	await page.clock.runFor(1000);
	await frame
		.getByRole("button", { name: "Pause playback", exact: true })
		.press("Enter");
	await expect(
		frame.getByRole("spinbutton", { name: "Playhead", exact: true })
	).not.toHaveValue("0");
	expect(errors).toEqual([]);
	await page.screenshot({
		path: path.join(proofDir, "video-export-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("production Video Studio resumes source analysis after a completed run without overlapping reads", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const project = newProject("Analysis preview");
	const asset = {
		id: crypto.randomUUID(),
		name: "Scene study.mp4",
		kind: "video",
		duration: 5,
		width: 1920,
		height: 1080,
		hasAudio: true,
		createdAt: "2026-09-12T00:00:00Z",
	};
	const html = await readFile(
		"/tmp/ryu-video-performance-build/index.html",
		"utf8"
	);
	const bridge = `<script>let reads=0,starts=0;const project=${JSON.stringify(project)},asset=${JSON.stringify(asset)};const analysis={assetId:asset.id,status:"completed",createdAt:asset.createdAt,sceneCuts:[2.5],waveform:[0.1,0.4,0.2,0.6,0.1],duration:5};window.ryu={app:{request:async({path,method})=>{if(path==="/projects")return {projects:[project]};if(path==="/assets")return {assets:[asset]};if(path==="/renders")return {jobs:[]};if(path.endsWith("/analysis")){document.body.dataset.analysisReads=String(++reads);if(reads===1)await new Promise(resolve=>{const done=e=>{if(e.data!=="release-analysis")return;removeEventListener("message",done);resolve()};addEventListener("message",done)});return {analysis:{...analysis,status:reads===2?"running":"completed"}}}if(path.endsWith("/analyze")&&method==="POST"){document.body.dataset.analysisStarts=String(++starts);return {...analysis,status:"running"}}throw Error("Unexpected fixture request "+path)}}};</script>`;
	await page.route("**/embedded-polling-child.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: html.replace("<head>", `<head>${bridge}`),
		})
	);
	await page.clock.install();
	await page.setViewportSize({ width: 1600, height: 1200 });
	await page.goto("/embedded-polling-proof.html");
	await page.locator("main").evaluate((element) => {
		element.style.maxWidth = "none";
	});
	await page.locator("iframe").evaluate((element) => {
		element.style.height = "950px";
	});
	const frame = page.frameLocator('iframe[title="Companion workspace"]');
	await frame
		.getByRole("button", { name: "View analysis", exact: true })
		.press("Enter");
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"1"
	);
	await page.clock.fastForward(6000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"1"
	);
	await page
		.locator("iframe")
		.evaluate((element: HTMLIFrameElement) =>
			element.contentWindow?.postMessage("release-analysis", "*")
		);
	await expect(
		frame.getByText("1 detected scene changes", { exact: true })
	).toBeVisible();
	await page.clock.fastForward(10_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"1"
	);
	await frame
		.getByRole("button", { name: "Analyze source", exact: true })
		.press("Enter");
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"2"
	);
	await expect(
		frame.getByText("Analyzing scenes and audio…", { exact: true })
	).toBeVisible();
	await page.getByRole("button", { name: "Another tab", exact: true }).click();
	await page.waitForTimeout(150);
	await page.clock.fastForward(10_000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"2"
	);
	await page.getByRole("button", { name: "Companion", exact: true }).click();
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"3"
	);
	await expect(
		frame.getByText("1 detected scene changes", { exact: true })
	).toBeVisible();
	await page.clock.fastForward(6000);
	await expect(frame.locator("body")).toHaveAttribute(
		"data-analysis-reads",
		"3"
	);
	await frame
		.getByText("1 detected scene changes", { exact: true })
		.scrollIntoViewIfNeeded();
	expect(errors).toEqual([]);
	await page.screenshot({
		path: path.join(proofDir, "video-analysis-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});
