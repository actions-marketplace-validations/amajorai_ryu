import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("plugin probes and invokes keep their deadlines through response consumption", async () => {
	const root = await mkdtemp(join(tmpdir(), "ryu-island-plugin-"));
	let contributionCalls = 0;
	let closed = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		idleTimeout: 150,
		port: 0,
		fetch(req) {
			const path = new URL(req.url).pathname;
			if (
				path.includes("slow") ||
				(path.endsWith("contributions") && ++contributionCalls > 1)
			) {
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("{"));
						},
						cancel() {
							closed++;
						},
					})
				);
			}
			if (path.includes("missing")) {
				return new Response("missing", { status: 404 });
			}
			if (path.includes("denied")) {
				return Response.json(
					{ error: { code: "denied", message: "fixture denied" } },
					{ status: 403 }
				);
			}
			if (path.endsWith("contributions")) {
				return Response.json({ companions: [], views: [] });
			}
			if (path.endsWith("ui-bundle")) {
				return Response.json({ code: "fixture-code" });
			}
			if (path.endsWith("host")) {
				return Response.json({ result: { value: 2 } });
			}
			return Response.json({ value: 1 });
		},
	});
	try {
		for (const name of ["plugin-host.ts", "response-deadline.ts", "sse.ts"]) {
			await copyFile(join(import.meta.dirname, name), join(root, name));
		}
		await writeFile(
			join(root, "config.ts"),
			`export const coreHeaders = () => ({}); export const loadConfig = () => ({ coreBaseUrl: ${JSON.stringify(server.url.toString().replace(/\/$/, ""))} });`
		);
		await writeFile(
			join(root, "run.ts"),
			'import * as host from "./plugin-host.ts"; const normal = await Promise.all([host.pluginContributions(), host.pluginUiBundle("fixture"), host.pluginUiBundle("missing"), host.pluginHostInvoke("fixture", "storage.get", {}), host.pluginHostInvoke("denied", "storage.get", {}), host.pluginCoreHttp({ method: "GET", path: "/api/okay" })]); const began = performance.now(); const stalled = await Promise.all([host.pluginContributions(), host.pluginUiBundle("slow"), host.pluginHostInvoke("slow", "storage.get", {}), host.pluginCoreHttp({ method: "GET", path: "/api/slow" })]); process.stdout.write(JSON.stringify({ normal, stalled, elapsedMs: performance.now() - began }));'
		);
		const child = Bun.spawn([process.execPath, join(root, "run.ts")], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const result = (await new Response(child.stdout).json()) as {
			normal: unknown[];
			stalled: unknown[];
			elapsedMs: number;
		};
		expect(await child.exited).toBe(0);
		expect(result.normal).toEqual([
			{ available: true, companions: [], views: [] },
			{ available: true, code: "fixture-code" },
			{ available: true, code: null },
			{ ok: true, result: { value: 2 } },
			{ ok: false, code: "denied", message: "fixture denied" },
			{ ok: true, status: 200, data: { value: 1 } },
		]);
		expect(result.stalled).toEqual([
			{ available: false, reason: "timeout" },
			{ available: false, reason: "timeout" },
			{ ok: false, code: "server_error", message: "timeout" },
			{ ok: false, code: "server_error", message: "timeout" },
		]);
		expect(result.elapsedMs).toBeGreaterThanOrEqual(119_000);
		const deadline = Date.now() + 1000;
		while (closed < 4 && Date.now() < deadline) {
			await Bun.sleep(5);
		}
		expect(closed).toBe(4);
	} finally {
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
}, 150_000);
