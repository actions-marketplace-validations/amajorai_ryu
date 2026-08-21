import { describe, expect, it } from "bun:test";
import type { UsageEvent } from "@ryu/blocks/desktop/usage-analytics.ts";
import { withoutDuplicateManagedCharges } from "./usage-analytics.ts";

describe("withoutDuplicateManagedCharges", () => {
	it("drops ledger rows already represented by managed audit events", () => {
		const auditEvents: UsageEvent[] = [
			{
				requestId: "req-1",
				source: "managed",
				timestamp: "2026-08-21T00:00:00Z",
			},
		];
		const creditEvents: UsageEvent[] = [
			{
				requestId: "req-1",
				source: "managed",
				timestamp: "2026-08-21T00:00:00Z",
			},
			{
				requestId: "req-2",
				source: "managed",
				timestamp: "2026-08-21T00:01:00Z",
			},
			{ requestId: null, source: "managed", timestamp: "2026-08-21T00:02:00Z" },
		];

		expect(withoutDuplicateManagedCharges(auditEvents, creditEvents)).toEqual([
			creditEvents[1],
			creditEvents[2],
		]);
	});
});
