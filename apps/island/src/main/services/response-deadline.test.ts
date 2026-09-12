import { expect, test } from "bun:test";
import { withResponseDeadline } from "./response-deadline.ts";

test("deadline covers a stalled body even when the parser catches read errors", async () => {
	let closed = false;
	let bodyStarted = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{"pending":'));
					},
					cancel() {
						closed = true;
					},
				}),
				{ headers: { "Content-Type": "application/json" } }
			);
		},
	});
	try {
		await expect(
			withResponseDeadline(server.url.toString(), {}, 200, (response) => {
				bodyStarted = true;
				return response.json().catch(() => null);
			})
		).rejects.toThrow();
		const deadline = Date.now() + 1000;
		while (!closed && Date.now() < deadline) {
			await Bun.sleep(5);
		}
		expect(bodyStarted).toBe(true);
		expect(closed).toBe(true);
	} finally {
		server.stop(true);
	}
});

test("caller cancellation releases body reads and successful parsing preserves data", async () => {
	const controller = new AbortController();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			if (new URL(req.url).pathname === "/ok") {
				return Response.json({ ready: true });
			}
			return new Response(new ReadableStream());
		},
	});
	try {
		expect(
			await withResponseDeadline(`${server.url}ok`, {}, 1000, (response) =>
				response.json()
			)
		).toEqual({ ready: true });
		const pending = withResponseDeadline(
			server.url.toString(),
			{ signal: controller.signal },
			1000,
			(response) => response.json()
		);
		controller.abort();
		await expect(pending).rejects.toThrow();
	} finally {
		server.stop(true);
	}
});
