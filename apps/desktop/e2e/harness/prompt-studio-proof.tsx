import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PromptStudio } from "../../src/components/PromptStudio.tsx";
import type {
	EvalCaseScore,
	EvalRunResult,
} from "../../src/lib/api/gateway.ts";
import "../../src/index.css";

const TARGET = { token: null, url: "http://127.0.0.1:8780" };
const AGENT_ID = "prompt-studio-proof-agent";

let savedPrompt = "You are a concise assistant.\n\nUse {{topic}}.";
let savedVersion = false;
let savedSuite = false;
let runCounter = 0;
const proofRuns = new Map<
	string,
	{
		created_at: number;
		id: string;
		name: string;
		request: Record<string, unknown>;
		result: Record<string, unknown>;
		suite_id: string;
	}
>();
const savedReviews = new Map<string, Record<string, unknown>>();
let savedRun = false;
let savedRunName = "Promptfoo regression suite · proof";
let savedRunResult: Record<string, unknown> | null = null;
let duplicatedRun = false;

const EVAL_CASES: EvalCaseScore[] = [
	{
		assertion_score: 1,
		assertions: [
			{
				detail: 'found one of the values: "concise"',
				executed: true,
				kind: "icontains_any",
				pass: true,
				score: 1,
			},
			{
				detail: "judge verdict: PASS SCORE: 0.9",
				executed: true,
				kind: "llm_rubric",
				pass: true,
				score: 0.9,
			},
		],
		assertions_pass: true,
		cache_hit: false,
		cost_micro_usd: 2400,
		description: "Concise answer",
		evaluators: [
			{
				category: "quality",
				detail: "exact match",
				executed: true,
				id: "exact_match",
				pass: true,
				score: 1,
			},
		],
		id: "case-concise",
		input_tokens: 42,
		latency_ms: 640,
		latency_score: 0.94,
		metadata: { locale: "en", team: "support" },
		overall: 0.88,
		policy_pass: true,
		prompt: "Explain topic: prompt engineering",
		prompt_id: "primary",
		provider: "openai",
		rendered_prompt:
			"You are a concise assistant. Explain topic: prompt engineering",
		response_text: "A concise explanation of prompt engineering.",
		substring_match: 1,
		token_efficiency: 0.72,
		total_tokens: 60,
		vars: { topic: "prompt engineering" },
	},
	{
		assertion_score: 0,
		assertions: [
			{
				detail: 'missing one of the values: "concise"',
				executed: true,
				kind: "icontains_any",
				pass: false,
				score: 0,
			},
		],
		assertions_pass: false,
		cache_hit: false,
		cost_micro_usd: 1800,
		description: "Avoid a verbose answer",
		evaluators: [],
		id: "case-brief",
		input_tokens: 38,
		latency_ms: 1240,
		latency_score: 0.72,
		metadata: { locale: "en", team: "support", severity: "review" },
		overall: 0.42,
		policy_pass: true,
		prompt: "Give a brief answer about prompt engineering",
		prompt_id: "primary",
		provider: "openai",
		rendered_prompt:
			"You are a concise assistant. Give a brief answer about prompt engineering",
		response_text: "Prompt engineering is writing instructions for a model.",
		substring_match: 0,
		token_efficiency: 0.5,
		total_tokens: 54,
		vars: { topic: "prompt engineering" },
	},
];

function modelCases(model: string): EvalCaseScore[] {
	return EVAL_CASES.map((score, index) => ({
		...score,
		model,
		response_text:
			model === "gpt-4o-mini"
				? score.response_text
				: index === 0
					? "Prompt engineering is a method for writing model instructions."
					: "Use clear instructions and examples when prompting a model.",
		overall:
			model === "gpt-4o-mini" ? score.overall : index === 0 ? 0.79 : 0.68,
		prompt_id: "primary",
	}));
}

function aggregateFor(model: string) {
	const cases = modelCases(model);
	return {
		assertion_pass_rate: model === "gpt-4o-mini" ? 0.5 : 0,
		evaluators: {},
		mean_latency: model === "gpt-4o-mini" ? 0.83 : 0.78,
		mean_overall: model === "gpt-4o-mini" ? 0.65 : 0.735,
		mean_substring_match: 0.5,
		mean_token_efficiency: 0.61,
		policy_pass_rate: 1,
		total_cases: cases.length,
		total_cost_micro_usd: model === "gpt-4o-mini" ? 4200 : 3600,
		total_input_tokens: cases.reduce(
			(sum, score) => sum + (score.input_tokens ?? 0),
			0
		),
		total_output_tokens: cases.reduce(
			(sum, score) => sum + (score.output_tokens ?? 0),
			0
		),
	};
}

const EVAL_RESULT: EvalRunResult = {
	aggregate: aggregateFor("gpt-4o-mini"),
	cases: modelCases("gpt-4o-mini"),
	models: [
		{
			aggregate: aggregateFor("gpt-4o-mini"),
			cases: modelCases("gpt-4o-mini"),
			model: "gpt-4o-mini",
		},
		{
			aggregate: aggregateFor("gpt-4.1-mini"),
			cases: modelCases("gpt-4.1-mini"),
			model: "gpt-4.1-mini",
		},
	],
};

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
		status: 200,
	});
}

function installProofApi() {
	window.fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const runMatch = url.match(/\/runs\/([^/]+)/);
		const runId = runMatch?.[1] ? decodeURIComponent(runMatch[1]) : null;
		if (url.includes("/api/gateway/evals/run")) {
			return jsonResponse(EVAL_RESULT);
		}
		if (url.includes("/api/prompt-suites")) {
			if (url.endsWith("/reviews") && method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as Record<
					string,
					unknown
				>;
				const review = {
					comment: body.comment ?? null,
					highlighted: body.highlighted === true,
					pass: body.pass ?? null,
					result_key: String(body.result_key ?? ""),
					run_id: runId ?? "",
					score: body.score ?? null,
					updated_at: Date.now(),
				};
				savedReviews.set(`${review.run_id}:${review.result_key}`, review);
				return jsonResponse({ review });
			}
			if (url.endsWith("/reviews")) {
				return jsonResponse({
					reviews: [...savedReviews.values()].filter(
						(review) => !runId || review.run_id === runId
					),
				});
			}
			if (runId && url.endsWith("/duplicate") && method === "POST") {
				const source = proofRuns.get(runId);
				runCounter += 1;
				const duplicate = {
					created_at: Date.now(),
					id: `${runId}-copy-${runCounter}`,
					name: `${source?.name ?? "Proof run"} copy`,
					request: source?.request ?? {},
					result: source?.result ?? { variants: [] },
					suite_id: "ps_prompt_studio_proof",
				};
				proofRuns.set(duplicate.id, duplicate);
				return jsonResponse({ run: duplicate });
			}
			if (runId && !url.endsWith("/duplicate")) {
				const run = proofRuns.get(runId);
				if (method === "PUT") {
					const body = JSON.parse(String(init.body ?? "{}")) as {
						name?: string;
					};
					if (run && body.name) {
						run.name = body.name;
					}
					return jsonResponse({ run });
				}
				if (method === "DELETE") {
					proofRuns.delete(runId);
					for (const key of savedReviews.keys()) {
						if (key.startsWith(`${runId}:`)) {
							savedReviews.delete(key);
						}
					}
					return jsonResponse({});
				}
				return jsonResponse({
					run: run ?? {
						created_at: Date.now(),
						id: runId,
						name: "Proof run",
						request: {},
						result: { variants: [] },
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (url.endsWith("/runs") && method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					name?: string;
					request?: Record<string, unknown>;
					result?: Record<string, unknown>;
				};
				runCounter += 1;
				const run = {
					created_at: Date.now(),
					id: `pr_prompt_studio_proof-${runCounter}`,
					name: body.name ?? `Proof run ${runCounter}`,
					request: body.request ?? {},
					result: body.result ?? {
						variants: [
							{
								promptId: "primary",
								promptName: "Primary",
								result: EVAL_RESULT,
							},
						],
					},
					suite_id: "ps_prompt_studio_proof",
				};
				proofRuns.set(run.id, run);
				return jsonResponse({ run });
			}
			if (url.endsWith("/runs")) {
				return jsonResponse({
					runs: [...proofRuns.values()].map((run) => ({
						created_at: run.created_at,
						id: run.id,
						name: run.name,
						suite_id: run.suite_id,
					})),
				});
			}
			if (url.endsWith("/reviews") && init?.method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as Record<
					string,
					unknown
				>;
				const review = {
					comment: body.comment ?? null,
					highlighted: body.highlighted === true,
					pass: body.pass ?? null,
					result_key: String(body.result_key ?? ""),
					run_id: url.includes("pr_prompt_studio_proof_copy")
						? "pr_prompt_studio_proof_copy"
						: "pr_prompt_studio_proof",
					score: body.score ?? null,
					updated_at: Date.now(),
				};
				savedReviews.set(String(review.result_key), review);
				return jsonResponse({ review });
			}
			if (url.endsWith("/reviews")) {
				return jsonResponse({ reviews: [...savedReviews.values()] });
			}
			if (
				(url.endsWith("/pr_prompt_studio_proof") ||
					url.endsWith("/pr_prompt_studio_proof_copy")) &&
				init?.method === "PUT"
			) {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					name?: string;
				};
				if (body.name) {
					savedRunName = body.name;
				}
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: url.endsWith("_copy")
							? "pr_prompt_studio_proof_copy"
							: "pr_prompt_studio_proof",
						name: savedRunName,
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (
				url.endsWith("/pr_prompt_studio_proof") &&
				init?.method === "DELETE"
			) {
				savedRun = false;
				return jsonResponse({});
			}
			if (url.endsWith("/pr_prompt_studio_proof/duplicate")) {
				duplicatedRun = true;
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: "pr_prompt_studio_proof_copy",
						name: `${savedRunName} copy`,
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (url.endsWith("/pr_prompt_studio_proof")) {
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: "pr_prompt_studio_proof",
						name: savedRunName,
						request: {},
						result: savedRunResult ?? {
							variants: [
								{
									promptId: "primary",
									promptName: "Primary",
									result: EVAL_RESULT,
								},
							],
						},
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (url.endsWith("/runs") && init?.method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					name?: string;
					result?: Record<string, unknown>;
				};
				savedRun = true;
				savedRunName = body.name ?? savedRunName;
				savedRunResult = body.result ?? null;
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: "pr_prompt_studio_proof",
						name: savedRunName,
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (url.endsWith("/runs")) {
				return jsonResponse({
					runs: savedRun
						? [
								{
									created_at: Date.now(),
									id: "pr_prompt_studio_proof",
									name: savedRunName,
									suite_id: "ps_prompt_studio_proof",
								},
								...(duplicatedRun
									? [
											{
												created_at: Date.now(),
												id: "pr_prompt_studio_proof_copy",
												name: `${savedRunName} copy`,
												suite_id: "ps_prompt_studio_proof",
											},
										]
									: []),
							]
						: [],
				});
			}
			if (
				url.endsWith("/pr_prompt_studio_proof_copy") ||
				url.endsWith("/pr_prompt_studio_proof")
			) {
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: url.endsWith("_copy")
							? "pr_prompt_studio_proof_copy"
							: "pr_prompt_studio_proof",
						name: url.endsWith("_copy") ? `${savedRunName} copy` : savedRunName,
						request: {},
						result: savedRunResult ?? {
							variants: [
								{
									promptId: "primary",
									promptName: "Primary",
									result: EVAL_RESULT,
								},
							],
						},
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (init?.method === "POST") {
				savedSuite = true;
				return jsonResponse({
					suite: {
						agent_id: AGENT_ID,
						config: {},
						created_at: Date.now(),
						id: "ps_prompt_studio_proof",
						name: "Promptfoo regression suite",
						updated_at: Date.now(),
					},
					version: {
						created_at: Date.now(),
						id: "psv_prompt_studio_proof",
						label: "Baseline",
						suite_id: "ps_prompt_studio_proof",
					},
				});
			}
			if (url.includes("/versions")) {
				return jsonResponse({ versions: [] });
			}
			return jsonResponse({ suites: savedSuite ? [] : [] });
		}
		if (url.includes(`/api/agents/${AGENT_ID}/prompt-versions`)) {
			const isRestore = url.endsWith("/restore");
			if (isRestore) {
				savedPrompt = "You are a precise assistant.\n\nUse {{topic}}.";
				return jsonResponse({ prompt: savedPrompt, source: savedPrompt });
			}
			if (init?.method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					prompt?: string;
				};
				savedPrompt = body.prompt ?? savedPrompt;
				savedVersion = true;
				return jsonResponse({
					version: {
						agent_id: AGENT_ID,
						created_at: Date.now(),
						id: "apv_prompt_studio_proof",
						label: "Baseline",
					},
				});
			}
			if (url.endsWith("/prompt-versions")) {
				return jsonResponse({
					versions: savedVersion
						? [
								{
									agent_id: AGENT_ID,
									created_at: Date.now(),
									id: "apv_prompt_studio_proof",
									label: "Baseline",
								},
							]
						: [],
				});
			}
			return jsonResponse({
				version: { prompt: savedPrompt, source: savedPrompt },
			});
		}
		return jsonResponse({});
	};
}

function PromptStudioProof() {
	const [prompt, setPrompt] = useState(savedPrompt);

	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
			<div className="mx-auto max-w-5xl">
				<header className="mb-6 flex items-start justify-between gap-4 border-b pb-5">
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
							Production component proof
						</p>
						<h1 className="mt-2 font-semibold text-3xl tracking-tight">
							Prompt Studio
						</h1>
						<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
							Prompt editing, durable history, Promptfoo-style assertions,
							thresholds, and model comparison.
						</p>
					</div>
					<div
						className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-700 text-xs dark:text-emerald-300"
						data-testid="proof-status"
					>
						Production UI mounted
					</div>
				</header>
				<PromptStudio
					agentId={AGENT_ID}
					engine="openai_compat"
					locked={false}
					model="gpt-4o-mini"
					onChange={setPrompt}
					target={TARGET}
					value={prompt}
					version="1.2.0"
				/>
			</div>
		</main>
	);
}

installProofApi();
createRoot(document.getElementById("root")!).render(<PromptStudioProof />);
