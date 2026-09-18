import { describe, expect, test } from "bun:test";
import type { AuditEntry } from "@/src/lib/api/gateway.ts";
import {
	filterAuditEntries,
	summarizeAudit,
} from "./AgentObservabilityView.tsx";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		agent_id: "agent-1",
		api_key: "***",
		backend: null,
		command: null,
		cost_micro_usd: 1250,
		duration_ms: null,
		error: null,
		eval_score: 0.8,
		event_type: "model_call",
		feature: "chat",
		id: "audit-1",
		input_tokens: 100,
		latency_ms: 500,
		model: "gpt-4o-mini",
		output_tokens: 50,
		provider: "openai",
		request_id: "req-1",
		session_id: "run-1",
		timestamp: "2026-09-10T00:00:00Z",
		user_id: null,
		user_name: null,
		...overrides,
	};
}

describe("agent observability aggregates", () => {
	test("summarizes latency, tokens, cost, errors, and quality", () => {
		const summary = summarizeAudit([
			entry(),
			entry({
				cost_micro_usd: null,
				error: "timeout",
				eval_score: null,
				id: "audit-2",
				input_tokens: 25,
				latency_ms: 1500,
				output_tokens: 10,
			}),
		]);

		expect(summary).toEqual({
			averageLatencyMs: 1000,
			costMicroUsd: 1250,
			errorCount: 1,
			qualityScore: 0.8,
			totalInputTokens: 125,
			totalOutputTokens: 60,
			totalRequests: 2,
		});
	});

	test("filters errors, slow calls, event kind, and search terms", () => {
		const values = [
			entry(),
			entry({
				event_type: "exec_call",
				id: "audit-2",
				latency_ms: 1500,
				model: null,
				provider: null,
				command: "write_file",
			}),
			entry({
				error: "provider timeout",
				id: "audit-3",
				latency_ms: 2000,
			}),
		];

		expect(
			filterAuditEntries(values, "", "errors").map((item) => item.id)
		).toEqual(["audit-3"]);
		expect(
			filterAuditEntries(values, "", "slow").map((item) => item.id)
		).toEqual(["audit-2", "audit-3"]);
		expect(
			filterAuditEntries(values, "write_file", "all").map((item) => item.id)
		).toEqual(["audit-2"]);
		expect(
			filterAuditEntries(values, "", "tool").map((item) => item.id)
		).toEqual(["audit-2"]);
	});
});
