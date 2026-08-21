import { describe, expect, it } from "bun:test";
import { aggregateUsageEvents } from "./usage-analytics.ts";

const RANGE = {
	from: new Date("2026-08-17T00:00:00.000Z"),
	to: new Date("2026-08-18T00:00:00.000Z"),
};

describe("aggregateUsageEvents", () => {
	it("keeps non-credit traffic visible without inventing spend", () => {
		const data = aggregateUsageEvents({
			caption: "Node traffic",
			events: [
				{
					durationMs: 100,
					feature: "Chat",
					inputTokens: 10,
					memberId: "user-1",
					model: "llama",
					nodeId: "node-1",
					outputTokens: 5,
					provider: "local",
					source: "local",
					timestamp: "2026-08-17T09:05:00.000Z",
				},
				{
					durationMs: 300,
					error: true,
					inputTokens: 20,
					memberId: "user-2",
					model: "gpt",
					nodeId: "node-1",
					outputTokens: 10,
					provider: "openai",
					source: "byok",
					timestamp: "2026-08-17T09:16:00.000Z",
				},
			],
			from: RANGE.from,
			granularity: "15m",
			scope: "node",
			scopeLabel: "This node",
			to: RANGE.to,
		});

		expect(data.totals).toMatchObject({
			activeDays: 1,
			activeMembers: 2,
			activeNodes: 1,
			averageLatencyMs: 200,
			errors: 1,
			inputTokens: 30,
			outputTokens: 15,
			requests: 2,
			spendMicroUsd: null,
		});
		expect(data.buckets.filter((bucket) => bucket.requests > 0)).toHaveLength(
			2
		);
		expect(data.bySource.map((row) => row.label)).toEqual(["BYOK", "Local"]);
		expect(data.byProvider.map((row) => row.key)).toEqual(["openai", "local"]);
	});

	it("attributes managed spend and excludes events outside the half-open range", () => {
		const data = aggregateUsageEvents({
			caption: "Organization traffic",
			events: [
				{
					costMicroUsd: 1250,
					inputTokens: 100,
					model: "managed-model",
					outputTokens: 50,
					provider: "openai-credits",
					source: "managed",
					timestamp: "2026-08-17T12:00:00.000Z",
				},
				{
					costMicroUsd: 9999,
					inputTokens: 1,
					model: "outside",
					outputTokens: 1,
					provider: "openai-credits",
					source: "managed",
					timestamp: "2026-08-18T00:00:00.000Z",
				},
			],
			from: RANGE.from,
			granularity: "hourly",
			scope: "organization",
			scopeLabel: "Organization",
			to: RANGE.to,
		});

		expect(data.totals.requests).toBe(1);
		expect(data.totals.spendMicroUsd).toBe(1250);
		expect(data.byModel).toEqual([
			{
				key: "managed-model",
				label: "managed-model",
				requests: 1,
				spendMicroUsd: 1250,
				tokens: 150,
			},
		]);
	});

	it("can add ledger-only spend without inflating request counts", () => {
		const data = aggregateUsageEvents({
			caption: "Credit ledger",
			events: [
				{
					costMicroUsd: 500,
					model: "managed-model",
					provider: "openai-credits",
					requestCount: 0,
					source: "managed",
					timestamp: "2026-08-17T12:00:00.000Z",
				},
			],
			from: RANGE.from,
			granularity: "daily",
			scope: "organization",
			scopeLabel: "Organization",
			to: RANGE.to,
		});

		expect(data.totals.requests).toBe(0);
		expect(data.totals.spendMicroUsd).toBe(500);
		expect(data.buckets[0]?.spendMicroUsd).toBe(500);
	});
});
