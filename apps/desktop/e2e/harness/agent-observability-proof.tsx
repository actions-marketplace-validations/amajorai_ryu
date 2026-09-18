import { createRoot } from "react-dom/client";
import { AgentObservabilityView } from "../../src/components/agents/AgentObservabilityView.tsx";
import type { AuditEntry } from "../../src/lib/api/gateway.ts";
import "../../src/index.css";

const TARGET = { token: null, url: "http://127.0.0.1:8780" };
const AGENT_ID = "observability-proof-agent";

const SUITE = {
	agent_id: AGENT_ID,
	config: { prompts: [], providers: ["gpt-4o-mini"], tests: [] },
	created_at: Date.now(),
	id: "suite-observability-proof",
	name: "Agent regression suite",
	updated_at: Date.now(),
};

const AUDIT_ENTRIES: AuditEntry[] = [
	{
		agent_id: AGENT_ID,
		api_key: "***",
		backend: "openai",
		command: null,
		cost_micro_usd: 2400,
		duration_ms: null,
		error: null,
		eval_score: 0.92,
		event_type: "model_call",
		feature: "chat",
		id: "audit-proof-success",
		input_tokens: 420,
		latency_ms: 640,
		model: "gpt-4o-mini",
		output_tokens: 180,
		provider: "openai",
		request_id: "req-proof-success",
		session_id: "run-proof-success",
		timestamp: "2026-09-10T08:10:00Z",
		user_id: null,
		user_name: null,
	},
	{
		agent_id: AGENT_ID,
		api_key: "***",
		backend: "anthropic",
		command: null,
		cost_micro_usd: 1100,
		duration_ms: null,
		error: "provider timeout",
		eval_score: null,
		event_type: "model_call",
		feature: "chat",
		id: "audit-proof-error",
		input_tokens: 260,
		latency_ms: 1840,
		model: "claude-3-5-sonnet",
		output_tokens: 0,
		provider: "anthropic",
		request_id: "req-proof-error",
		session_id: "run-proof-error",
		timestamp: "2026-09-10T08:09:00Z",
		user_id: null,
		user_name: null,
	},
];

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
		status: 200,
	});
}

function installProofApi() {
	window.fetch = async (input) => {
		const url = String(input);
		if (url.includes("/api/gateway/evals/score")) {
			return jsonResponse({
				kind: "online_score",
				score: {
					assertion_score: 1,
					assertions: [],
					assertions_pass: true,
					latency_score: 0.98,
					mean_overall: 0.91,
					overall: 0.91,
					policy_pass: true,
					prompt: "",
					response_text: "A grounded answer.",
					substring_match: null,
					token_efficiency: 0.84,
				},
				scored_at: new Date().toISOString(),
			});
		}
		if (url.includes("/api/gateway/audit")) {
			return jsonResponse({
				count: AUDIT_ENTRIES.length,
				entries: AUDIT_ENTRIES,
				reachable: true,
			});
		}
		if (url.includes("/api/gateway/redteam/run")) {
			return jsonResponse({
				campaign_id: "rtc-proof",
				model: "gpt-4o-mini",
				strategies: [
					"Prompt injection",
					"Jailbreak resistance",
					"PII exfiltration",
					"Tool misuse",
					"Toxic output",
				].map((name, index) => ({
					detail: "Evaluator detected the unsafe behavior was blocked.",
					evaluator: index === 0 ? "prompt_injection" : "toxicity",
					id: `strategy-proof-${index}`,
					name,
					protected: true,
				})),
				summary: { needs_attention: 0, protected: 5, total: 5 },
			});
		}
		if (url.includes("/api/runs/run-proof-success/trace")) {
			return jsonResponse({
				spans: [
					{
						args_hash: null,
						conversation_id: "run-proof-success",
						ended_at: 1_728_000_340_000,
						error: null,
						id: "span-proof-model",
						kind: "model-call",
						name: "gpt-4o-mini",
						seq: 1,
						session_id: "run-proof-success",
						started_at: 1_728_000_339_360,
					},
					{
						args_hash: "4edc3c76f9b1",
						conversation_id: "run-proof-success",
						ended_at: 1_728_000_340_180,
						error: null,
						id: "span-proof-tool",
						kind: "tool-call",
						name: "search_docs",
						seq: 2,
						session_id: "run-proof-success",
						started_at: 1_728_000_340_000,
					},
				],
			});
		}
		if (url.includes("/api/prompt-suites")) {
			if (url.endsWith("/traces")) {
				return jsonResponse({
					added: true,
					case: {
						id: "trace-run-proof-success",
						metadata: { source: "ryu-trace" },
						prompt: "Explain the linked run",
						expected: "A grounded answer",
					},
					source_run_id: "run-proof-success",
					suite: SUITE,
					version: {
						created_at: Date.now(),
						id: "version-trace-proof",
						label: "Trace import",
						suite_id: SUITE.id,
					},
				});
			}
			if (url.includes("/api/prompt-suites?") && !url.endsWith("/traces")) {
				return jsonResponse({ suites: [] });
			}
			if (url.endsWith("/api/prompt-suites")) {
				return jsonResponse({
					suite: SUITE,
					version: {
						created_at: Date.now(),
						id: "version-suite-proof",
						label: "Trace baseline",
						suite_id: SUITE.id,
					},
				});
			}
		}
		return jsonResponse({ spans: [] });
	};
}

function AgentObservabilityProof() {
	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
			<div className="mx-auto max-w-6xl">
				<header className="mb-6 flex items-start justify-between gap-4 border-b pb-5">
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
							Production component proof
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							Agent observability
						</h1>
						<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
							Live audit rollups, searchable events, and correlated Core spans
							for one agent.
						</p>
					</div>
					<div
						className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-700 text-xs dark:text-emerald-300"
						data-testid="proof-status"
					>
						Production UI mounted
					</div>
				</header>
				<AgentObservabilityView
					agentId={AGENT_ID}
					defaultModel="gpt-4o-mini"
					onOpenRun={(conversationId) => {
						document.body.dataset.openedRun = conversationId;
					}}
					target={TARGET}
				/>
			</div>
		</main>
	);
}

installProofApi();
createRoot(document.getElementById("root")!).render(
	<AgentObservabilityProof />
);
