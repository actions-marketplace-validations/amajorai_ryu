import { describe, expect, it } from "bun:test";
import { openCreditAlertStream } from "./credits.ts";

const realFetch = globalThis.fetch;

describe("openCreditAlertStream", () => {
	it("parses a credit-alert SSE frame", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					'event: credit-alert\ndata: {"balanceMicroUsd":1000000,"createdAt":"2026-08-16T00:00:00.000Z","level":"warning","thresholdMicroUsd":5000000,"title":"Your Ryu credit balance is low ($1.00)"}\n\n',
					{ headers: { "Content-Type": "text/event-stream" } }
				)
			)) as unknown as typeof globalThis.fetch;
		try {
			const stream = openCreditAlertStream(new AbortController().signal);
			await expect(stream.next()).resolves.toMatchObject({
				done: false,
				value: {
					data: {
						balanceMicroUsd: 1_000_000,
						level: "warning",
						thresholdMicroUsd: 5_000_000,
					},
					event: "credit-alert",
				},
			});
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
