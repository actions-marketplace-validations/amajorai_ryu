import { afterEach, expect, test } from "bun:test";
import { checkForUpdate, getVersionInfo } from "./update.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

for (const kind of ["version", "update"] as const) {
	test(`${kind} cancellation closes the pending HTTP body`, async () => {
		let closed = false;
		let receivedHeaders = false;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("{"));
						},
						cancel() {
							closed = true;
						},
					})
				);
			},
		});
		globalThis.fetch = Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const response = await realFetch(input, init);
				receivedHeaders = true;
				return response;
			},
			{ preconnect: realFetch.preconnect }
		);
		try {
			const controller = new AbortController();
			const target = {
				url: server.url.toString(),
				token: "test",
				userJwt: "test",
			};
			const result = (
				kind === "version"
					? getVersionInfo(target, controller.signal)
					: checkForUpdate(target, { signal: controller.signal })
			).then(
				(value) => value,
				() => "aborted"
			);
			const startDeadline = Date.now() + 1000;
			while (!receivedHeaders && Date.now() < startDeadline) {
				await Bun.sleep(5);
			}
			expect(receivedHeaders).toBe(true);
			controller.abort();
			const closeDeadline = Date.now() + 1000;
			while (!closed && Date.now() < closeDeadline) {
				await Bun.sleep(5);
			}
			expect(closed).toBe(true);
			if (kind === "version") {
				expect(await result).toBe("aborted");
			} else {
				expect(await result).toMatchObject({
					update_available: false,
					current: "",
					latest: "",
				});
			}
		} finally {
			await server.stop(true);
		}
	});
}
