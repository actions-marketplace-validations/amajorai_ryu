import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("meeting and quest subscriptions release rejected bodies and cancelled retries", async () => {
	const root = await mkdtemp(join(tmpdir(), "ryu-island-subscriptions-"));
	let closed = 0;
	let requests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			const active = req.headers.has("x-active");
			requests++;
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								active
									? 'data: {"id":"first"}\n\ndata: {"id":"second"}\n\n'
									: "unavailable"
							)
						);
					},
					cancel() {
						closed++;
					},
				}),
				{ status: active ? 200 : 503 }
			);
		},
	});
	try {
		for (const name of [
			"meetings.ts",
			"quests.ts",
			"response-deadline.ts",
			"reconnect-delay.ts",
		]) {
			await copyFile(join(import.meta.dirname, name), join(root, name));
		}
		await writeFile(
			join(root, "config.ts"),
			`let active=false; export const activate=()=>{active=true;}; export const coreHeaders=()=>active ? {"x-active":"1"} : {}; export const loadConfig=()=>({coreBaseUrl:${JSON.stringify(server.url.toString().replace(/\/$/, ""))}});`
		);
		await writeFile(
			join(root, "run.ts"),
			`
import {subscribeMeetingEvents} from "./meetings.ts";
import {subscribeQuestEvents} from "./quests.ts";
import {activate} from "./config.ts";
const timers = new Set(); const originalSet = globalThis.setTimeout; const originalClear = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {const timer=originalSet(fn,ms,...args); if(ms===3000)timers.add(timer); return timer;};
globalThis.clearTimeout = timer => {timers.delete(timer); originalClear(timer);};
const controllers=[new AbortController(),new AbortController()];
subscribeMeetingEvents(()=>{},controllers[0].signal); subscribeQuestEvents(()=>{},controllers[1].signal);
const deadline=Date.now()+1000; while(timers.size<2 && Date.now()<deadline) await Bun.sleep(5);
const before=timers.size; for(const controller of controllers)controller.abort(); await Bun.sleep(20);
const after=timers.size; activate();
const received=[[],[]]; const live=[new AbortController(),new AbortController()];
subscribeMeetingEvents(event=>{received[0].push(event.id);live[0].abort();},live[0].signal);
subscribeQuestEvents(event=>{received[1].push(event.id);live[1].abort();},live[1].signal);
const stop=Date.now()+1000; while(received.some(events=>events.length===0) && Date.now()<stop) await Bun.sleep(5);
await Bun.sleep(30); process.stdout.write(JSON.stringify({before,after,received})); await Bun.sleep(1000);
`
		);
		const child = Bun.spawn([process.execPath, join(root, "run.ts")], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const reader = child.stdout.getReader();
		const first = await reader.read();
		expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({
			before: 2,
			after: 0,
			received: [["first"], ["first"]],
		});
		expect(closed).toBe(4);
		expect(requests).toBe(4);
		expect(await child.exited).toBe(0);
		reader.releaseLock();
	} finally {
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
}, 10_000);
