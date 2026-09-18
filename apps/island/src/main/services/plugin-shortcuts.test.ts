import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shortcut refresh bursts preserve bindings until a fresh parallel snapshot is ready", async () => {
	const root = await mkdtemp(join(tmpdir(), "ryu-shortcuts-"));
	const reads: Record<string, number> = {};
	const held: Array<() => void> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const path = new URL(req.url).pathname;
			if (path === "/stats") {
				return Response.json(reads);
			}
			if (path === "/release") {
				for (const release of held) {
					release();
				}
				return new Response(null, { status: 204 });
			}
			reads[path] = (reads[path] ?? 0) + 1;
			const round = reads[path];
			if (round === 1) {
				await new Promise<void>((resolve) => held.push(resolve));
			}
			return Response.json(
				path.endsWith("keybindings")
					? { value: JSON.stringify({ "plugin:fixture": String(round) }) }
					: { companions: [], views: [] }
			);
		},
	});
	try {
		const services = join(root, "main/services");
		await mkdir(services, { recursive: true });
		await mkdir(join(root, "shared"));
		for (const name of [
			"plugin-shortcuts",
			"plugin-host",
			"preferences",
			"preference-stream",
			"response-deadline",
			"reconnect-delay",
			"sse",
		]) {
			await copyFile(
				join(import.meta.dirname, `${name}.ts`),
				join(services, `${name}.ts`)
			);
		}
		await copyFile(
			join(import.meta.dirname, "../../shared/keybindings.ts"),
			join(root, "shared/keybindings.ts")
		);
		const base = server.url.toString().replace(/\/$/, "");
		await writeFile(
			join(services, "config.ts"),
			`export const coreHeaders=()=>({});export const loadConfig=()=>({coreBaseUrl:${JSON.stringify(base)}});`
		);
		await writeFile(
			join(root, "run.ts"),
			`
import {createPluginShortcutRefresh} from "./main/services/plugin-shortcuts.ts";
const applied=[];const refresh=createPluginShortcutRefresh((result,overrides)=>applied.push({available:result.available,overrides}));
const pending=refresh();const base=${JSON.stringify(base)};const end=Date.now()+2000;
while(Object.keys(await fetch(base+"/stats").then(r=>r.json())).length<2){if(Date.now()>end)throw Error("reads did not start together");await Bun.sleep(5);}
const before=applied.length;const burst=Array.from({length:20},()=>refresh());await fetch(base+"/release");await Promise.all([pending,...burst]);process.stdout.write(JSON.stringify({before,applied}));
`
		);
		const child = Bun.spawn([process.execPath, join(root, "run.ts")], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const result = await new Response(child.stdout).json();
		expect(await child.exited).toBe(0);
		expect(result).toEqual({
			before: 0,
			applied: [{ available: true, overrides: { "plugin:fixture": "2" } }],
		});
		expect(reads).toEqual({
			"/api/plugins/contributions": 2,
			"/api/preferences/keybindings": 2,
		});
	} finally {
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
}, 10_000);
