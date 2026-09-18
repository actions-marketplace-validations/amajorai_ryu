import { createRoot } from "react-dom/client";
import { Activity } from "../../../../apps-store/activity/ui/src/Activity.tsx";
import type { RyuBridge } from "../../../../apps-store/activity/ui/src/ryu.d.ts";
import type { ActivityItem } from "../../../../apps-store/activity/ui/src/types.ts";
import "../../../../apps-store/activity/ui/src/tailwind.css";

const AGENT_ID = "observability-proof-agent";
const RUN_ID = "run-proof-success";

const ACTIVITY: ActivityItem[] = [
	{
		agent_id: AGENT_ID,
		body: "A completed agent run is ready to inspect.",
		created_at: 1_789_334_700,
		id: "activity-proof-run",
		kind: "run_completed",
		level: "success",
		metadata: {},
		session_id: RUN_ID,
		source: "runs",
		title: "Agent run completed",
	},
];

const AUDIT = {
	count: 2,
	entries: [
		{
			agent_id: AGENT_ID,
			command: null,
			cost_micro_usd: 2400,
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
			session_id: RUN_ID,
			timestamp: "2026-09-10T08:10:00Z",
		},
		{
			agent_id: AGENT_ID,
			command: null,
			cost_micro_usd: 1100,
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
		},
	],
	reachable: true,
};

const bridge: RyuBridge = {
	activity: {
		audit: async () => AUDIT,
		prune: async () => ({ deleted_rows: 3 }),
		score: async () => ({
			score: { overall: 0.91 },
			kind: "online_score",
		}),
		eval: async () => ({
			aggregate: {
				mean_overall: 0.88,
				policy_pass_rate: 1,
				total_cases: 3,
			},
		}),
		importTrace: async () => ({
			added: true,
			suite: { name: "Agent regression suite" },
		}),
		list: async () => ACTIVITY,
		redteam: async () => ({
			model: "gpt-4o-mini",
			strategies: [
				"Prompt injection",
				"Jailbreak resistance",
				"PII exfiltration",
				"Tool misuse",
				"Toxic output",
			].map((name, index) => ({
				detail: "Evaluator detected the unsafe behavior was blocked.",
				id: `strategy-proof-${index}`,
				name,
				protected: true,
			})),
			summary: { needs_attention: 0, protected: 5, total: 5 },
		}),
		trace: async () => ({
			spans: [
				{
					args_hash: null,
					ended_at: 1_789_334_760_640,
					error: null,
					id: "span-proof-model",
					kind: "model-call",
					name: "gpt-4o-mini",
					started_at: 1_789_334_760_000,
				},
				{
					args_hash: "4edc3c76f9b1",
					ended_at: 1_789_334_761_180,
					error: null,
					id: "span-proof-tool",
					kind: "tool-call",
					name: "search_docs",
					started_at: 1_789_334_760_640,
				},
			],
		}),
	},
	context: null,
	shell: {
		openTab: async ({ conversationId }) => {
			document.body.dataset.openedRun = conversationId ?? "";
		},
		subscribeTheme: () => ({ dispose: () => undefined }),
		subscribeEvents: () => ({ dispose: () => undefined }),
	},
};

window.ryu = bridge;

function Proof() {
	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
			<div className="mx-auto max-w-6xl">
				<div
					className="mb-6 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-700 text-xs dark:text-emerald-300"
					data-testid="activity-proof-status"
				>
					Activity Companion mounted
				</div>
				<Activity />
			</div>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(<Proof />);
