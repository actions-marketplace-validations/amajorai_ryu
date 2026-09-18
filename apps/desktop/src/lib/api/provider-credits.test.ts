import { afterEach, expect, test } from "bun:test";
import {
	fetchProviderCredits,
	supportsProviderCredits,
} from "./provider-credits.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
test("credit eligibility and legacy response mapping remain intact", async () => {
	for (const id of ["openrouter", "DeepSeek", "moonshot"]) {
		expect(supportsProviderCredits(id)).toBe(true);
	}
	expect(supportsProviderCredits("unsupported")).toBe(false);
	globalThis.fetch = Object.assign(
		async () =>
			Response.json({
				provider_id: "openrouter",
				available: true,
				meters: [
					{ label: "Credit", values: [{ kind: "dollars", number: 12.5 }] },
				],
				retry_after_seconds: 2,
			}),
		{ preconnect: realFetch.preconnect }
	);
	expect(
		await fetchProviderCredits(
			{ url: "https://fixture.test", token: "fixture" },
			"openrouter"
		)
	).toEqual({
		providerId: "openrouter",
		available: true,
		reason: null,
		retryAfterSeconds: 2,
		meters: [
			{
				label: "Credit",
				values: [{ kind: "dollars", number: 12.5, unit: null }],
				expiresAt: [],
				resetsAt: null,
			},
		],
	});
});
test("credit cancellation releases a held HTTP body", async () => {
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
		const result = fetchProviderCredits(
			{ url: server.url.toString(), token: "fixture", userJwt: "fixture" },
			"openrouter",
			controller.signal
		).then(
			() => "complete",
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
		expect(await result).toBe("aborted");
	} finally {
		server.stop(true);
	}
});
