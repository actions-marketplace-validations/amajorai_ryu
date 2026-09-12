import { afterEach, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { streamChannel, subscribeChannel } from "./eventStream.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
});
async function until(predicate: () => boolean) {
	const end = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() > end) {
			throw new Error("stream fixture timed out");
		}
		await Bun.sleep(10);
	}
}
test("shares matching scopes, isolates changed credentials and closes the last subscriber", async () => {
	const requests: string[] = [];
	let closed = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			requests.push(
				`${request.headers.get("authorization")}/${request.headers.get("x-ryu-user-jwt")}`
			);
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode('event: quests\ndata: {"ok":true}\n\n')
						);
					},
					cancel() {
						closed++;
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } }
			);
		},
	});
	cleanups.push(() => server.stop(true));
	const target = {
		url: server.url.toString(),
		token: "fixture-node",
		userJwt: "fixture-user",
	};
	let delivered = 0;
	const a = subscribeChannel(target, "quests", () => delivered++);
	const b = subscribeChannel(target, "activity", () => undefined);
	const c = subscribeChannel(
		{ ...target, token: "fixture-new-node" },
		"quests",
		() => delivered++
	);
	const d = subscribeChannel(
		{ ...target, userJwt: "fixture-new-user" },
		"quests",
		() => delivered++
	);
	cleanups.push(a, b, c, d);
	await until(() => delivered === 3);
	expect(requests.length).toBe(3);
	a();
	await Bun.sleep(20);
	expect(closed).toBe(0);
	b();
	c();
	d();
	await until(() => closed === 3);
	const controller = new AbortController();
	controller.abort();
	await streamChannel(target, "quests", () => undefined, controller.signal);
	await Bun.sleep(20);
	expect(requests.length).toBe(3);
});

test("reconnect backoff releases completed abort listeners and cancels on unsubscribe", async () => {
	let requests = 0;
	const server = Bun.serve({
		port: 0,
		fetch() {
			requests++;
			return new Response("restart", { status: 503 });
		},
	});
	cleanups.push(() => server.stop(true));
	const OriginalController = globalThis.AbortController;
	const signals: AbortSignal[] = [];
	globalThis.AbortController = class extends OriginalController {
		constructor() {
			super();
			signals.push(this.signal);
		}
	};
	cleanups.push(() => {
		globalThis.AbortController = OriginalController;
	});
	const activeListenerCount = () =>
		signals
			.filter((candidate) => !candidate.aborted)
			.reduce(
				(sum, candidate) => sum + getEventListeners(candidate, "abort").length,
				0
			);
	const original = globalThis.fetch;
	let signal: AbortSignal | undefined;
	const counts: number[] = [];
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			if (signal) {
				counts.push(activeListenerCount());
			}
			return await original(input, init);
		},
		{ preconnect: original.preconnect }
	);
	cleanups.push(() => {
		globalThis.fetch = original;
	});
	const unsubscribe = subscribeChannel(
		{ url: server.url.toString(), token: null, userJwt: "fixture-user" },
		"quests",
		() => undefined
	);
	cleanups.push(unsubscribe);
	await until(() => requests === 4);
	expect(counts).toEqual([1, 1, 1, 1]);
	unsubscribe();
	expect(signal?.aborted).toBe(true);
	expect(activeListenerCount()).toBe(0);
});

test("a dispatch failure cancels the current response before retrying", async () => {
	let closed = 0;
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode("event: quests\ndata: {}\n\n")
						);
					},
					cancel() {
						closed++;
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } }
			);
		},
	});
	cleanups.push(() => server.stop(true));
	const unsubscribe = subscribeChannel(
		{ url: server.url.toString(), token: null, userJwt: "fixture-user" },
		"quests",
		() => {
			throw new Error("fixture subscriber failed");
		}
	);
	cleanups.push(unsubscribe);
	await until(() => closed === 1);
	unsubscribe();
	expect(closed).toBe(1);
});
