import { expect, test } from "bun:test";
import { streamRuns } from "./runStream.ts";

for (const rejected of [false, true]) {
	test(
		rejected
			? "rejected run streams release unread bodies"
			: "run streams stop buffered delivery after cancellation",
		async () => {
			let closed = false;
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch() {
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(
									new TextEncoder().encode(
										'data: {"type":"snapshot","runs":[]}\n\ndata: {"type":"snapshot","runs":[]}\n\n'
									)
								);
							},
							cancel() {
								closed = true;
							},
						}),
						{ status: rejected ? 403 : 200 }
					);
				},
			});
			try {
				const controller = new AbortController();
				let delivered = 0;
				await streamRuns(
					{ url: server.url.toString(), token: "fixture", userJwt: "fixture" },
					() => {
						delivered++;
						controller.abort();
					},
					controller.signal
				).catch(() => undefined);
				const deadline = Date.now() + 1000;
				while (!closed && Date.now() < deadline) {
					await Bun.sleep(5);
				}
				expect(delivered).toBe(rejected ? 0 : 1);
				expect(closed).toBe(true);
			} finally {
				server.stop(true);
			}
		}
	);
}
