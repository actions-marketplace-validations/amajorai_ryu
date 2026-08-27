import { StatsFooter } from "@ryu/blocks/desktop/agent-elements/stats-footer.tsx";
import type { StatsUsageSnapshot } from "@ryu/blocks/desktop/agent-elements/stats-model.ts";
import type { UIMessage } from "ai";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const NOW = Date.now();

const DEMO_MESSAGES = [
	{
		id: "stats-user-1",
		parts: [
			{
				text: "Compare the local model's context and cache behavior.",
				type: "text",
			},
		],
		role: "user",
	},
	{
		id: "stats-assistant-1",
		parts: [
			{ toolCallId: "tool-1", type: "tool-call" },
			{ output: "inspected", toolCallId: "tool-1", type: "tool-result" },
			{
				data: {
					cacheWriteTokens: 160,
					cachedTokens: 1200,
					completionTokens: 900,
					cost: { amount: 0.041, currency: "USD" },
					durationMs: 4500,
					observedAt: NOW - 115_000,
					promptTokens: 1800,
					totalTokens: 2700,
				},
				type: "data-ryu-stats",
			},
		],
		role: "assistant",
	},
	{
		id: "stats-compaction",
		parts: [
			{
				data: { postTokens: 18_000, preTokens: 120_000, trigger: "auto" },
				type: "compact_boundary",
			},
		],
		role: "assistant",
	},
	{
		id: "stats-user-2",
		parts: [{ text: "Now summarize the active session totals.", type: "text" }],
		role: "user",
	},
	{
		id: "stats-assistant-2",
		parts: [
			{ toolCallId: "tool-2", type: "tool-call" },
			{ output: "summarized", toolCallId: "tool-2", type: "tool-result" },
			{ toolCallId: "tool-3", type: "tool-call" },
			{ output: "done", toolCallId: "tool-3", type: "tool-result" },
			{
				data: {
					cacheWriteTokens: 80,
					cachedTokens: 800,
					completionTokens: 500,
					context_window: {
						context_window_size: 1_000_000,
						current_usage: { used: 42_000 },
					},
					cost: { amount: 0.087, currency: "USD" },
					durationMs: 3000,
					observedAt: NOW - 35_000,
					promptTokens: 1450,
					totalTokens: 1950,
				},
				type: "data-ryu-stats",
			},
		],
		role: "assistant",
	},
] as unknown as UIMessage[];

const USAGE: StatsUsageSnapshot = {
	available: true,
	extraUsageUsd: null,
	meters: [
		{
			expiresAt: [],
			label: "Extra usage",
			resetsAt: new Date(NOW + 18 * 60 * 60 * 1000).toISOString(),
			values: [
				{ currency: "EUR", kind: "dollars", number: 3.25, unit: "spent" },
				{ currency: "EUR", kind: "dollars", number: 10, unit: "cap" },
			],
		},
	],
	windows: [
		{
			label: "Session",
			model: null,
			resetsAt: new Date(NOW + 2.5 * 60 * 60 * 1000).toISOString(),
			usedPercent: 34,
			windowSeconds: 18_000,
		},
		{
			label: "Weekly",
			model: null,
			resetsAt: new Date(NOW + 4.5 * 24 * 60 * 60 * 1000).toISOString(),
			usedPercent: 61,
			windowSeconds: 604_800,
		},
		{
			label: "Sonnet",
			model: "Sonnet",
			resetsAt: null,
			usedPercent: 42,
			windowSeconds: 604_800,
		},
		{
			label: "Opus",
			model: "Opus",
			resetsAt: null,
			usedPercent: 18,
			windowSeconds: 604_800,
		},
		{
			label: "Fable",
			model: "Fable",
			resetsAt: null,
			usedPercent: 7,
			windowSeconds: 604_800,
		},
	],
};

function StatsPluginProof() {
	return (
		<main className="min-h-screen bg-[#0d1117] px-10 py-12 text-slate-100">
			<div className="mx-auto max-w-[1180px]">
				<header className="mb-8 flex items-start justify-between gap-8">
					<div>
						<p className="mb-3 font-semibold text-[11px] text-cyan-300/80 uppercase tracking-[0.24em]">
							RYU · PLUGIN PROOF
						</p>
						<h1 className="font-semibold text-4xl text-white tracking-tight">
							Session stats, provider-neutral.
						</h1>
						<p className="mt-3 max-w-2xl text-base text-slate-400 leading-7">
							The extracted <span className="text-slate-200">@ryu/stats</span>{" "}
							chat contribution rolls up turns, steps, tokens, prompt-cache
							activity, throughput, context, compaction, cost, and provider
							usage in one current-session surface.
						</p>
					</div>
					<div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 font-semibold text-[11px] text-emerald-300 uppercase tracking-wider">
						Rendered product proof
					</div>
				</header>

				<section className="rounded-2xl border border-slate-700/80 bg-slate-900/90 p-6 shadow-2xl shadow-black/20">
					<div className="mb-5 flex items-center justify-between gap-4 border-slate-700/70 border-b pb-5">
						<div>
							<p className="font-semibold text-[10px] text-slate-500 uppercase tracking-[0.2em]">
								Current assistant turn
							</p>
							<h2 className="mt-1 font-medium text-lg text-white">
								Local model · Claude [1m] context hint
							</h2>
						</div>
						<div className="text-right text-slate-500 text-xs">
							<p>session 2 turns · 3 tool steps</p>
							<p className="mt-1 text-cyan-300/80">
								Hover the stats strip for the full breakdown
							</p>
						</div>
					</div>
					<div
						className="rounded-xl border border-slate-700/70 bg-[#111827] px-5 py-4"
						data-testid="stats-plugin-proof"
					>
						<StatsFooter
							contextSize={200_000}
							conversationMessages={DEMO_MESSAGES}
							isMainChainActive={false}
							modelName="claude-code-[1m]"
							usage={USAGE}
						/>
					</div>
				</section>

				<div className="mt-6 grid gap-4 md:grid-cols-3">
					{[
						[
							"Providers",
							"ACP · BYOK · Ryu · local",
							"same normalized transcript contract",
						],
						[
							"Cache",
							"read · write · hit rate · timer",
							"latest turn or cumulative session",
						],
						[
							"Context",
							"window · usable % · compaction",
							"reported size before fallback",
						],
					].map(([title, value, detail]) => (
						<div
							className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
							key={title}
						>
							<p className="font-semibold text-[10px] text-slate-500 uppercase tracking-[0.18em]">
								{title}
							</p>
							<p className="mt-2 font-medium text-slate-200 text-sm">{value}</p>
							<p className="mt-1 text-slate-500 text-xs">{detail}</p>
						</div>
					))}
				</div>
			</div>
		</main>
	);
}

document.documentElement.classList.add("dark");
document.body.className = "m-0 min-w-[1100px] bg-[#0d1117]";
const proofRoot = document.getElementById("root");
if (!proofRoot) {
	throw new Error("stats proof root missing");
}
createRoot(proofRoot).render(<StatsPluginProof />);
