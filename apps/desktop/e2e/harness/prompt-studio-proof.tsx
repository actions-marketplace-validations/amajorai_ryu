import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PromptStudio } from "../../src/components/PromptStudio.tsx";
import type { EvalRunResult } from "../../src/lib/api/gateway.ts";
import "../../src/index.css";

const TARGET = { token: null, url: "http://127.0.0.1:8780" };
const AGENT_ID = "prompt-studio-proof-agent";

let savedPrompt = "You are a concise assistant.\n\nUse {{topic}}.";
let savedVersion = false;
let savedSuite = false;
let savedRun = false;

const EVAL_RESULT: EvalRunResult = {
	aggregate: {
		evaluators: {},
		mean_latency: 0.94,
		mean_overall: 0.88,
		mean_substring_match: 1,
		mean_token_efficiency: 0.72,
		policy_pass_rate: 1,
		total_cases: 1,
	},
	cases: [
		{
			assertion_score: 1,
			assertions: [
				{
					detail: 'found one of the values: "concise"',
					kind: "icontains_any",
					pass: true,
					score: 1,
				},
			],
			assertions_pass: true,
			evaluators: [],
			latency_score: 0.94,
			overall: 0.88,
			policy_pass: true,
			prompt: "Explain topic: prompt engineering",
			response_text: "A concise explanation of prompt engineering.",
			substring_match: 1,
			token_efficiency: 0.72,
		},
	],
	models: [
		{
			aggregate: {
				evaluators: {},
				mean_latency: 0.94,
				mean_overall: 0.88,
				mean_substring_match: 1,
				mean_token_efficiency: 0.72,
				policy_pass_rate: 1,
				total_cases: 1,
			},
			cases: [
				{
					assertion_score: 1,
					assertions: [
						{
							detail: 'found one of the values: \\"concise\\"',
							kind: "icontains_any",
							pass: true,
							score: 1,
						},
					],
					assertions_pass: true,
					evaluators: [],
					latency_score: 0.94,
					overall: 0.88,
					policy_pass: true,
					prompt: "Explain topic: prompt engineering",
					response_text: "A concise explanation of prompt engineering.",
					substring_match: 1,
					token_efficiency: 0.72,
				},
			],
			model: "gpt-4o-mini",
		},
		{
			aggregate: {
				evaluators: {},
				mean_latency: 0.9,
				mean_overall: 0.79,
				mean_substring_match: 1,
				mean_token_efficiency: 0.64,
				policy_pass_rate: 1,
				total_cases: 1,
			},
			cases: [
				{
					assertion_score: 1,
					assertions: [
						{
							detail: 'found one of the values: \\"concise\\"',
							kind: "icontains_any",
							pass: true,
							score: 1,
						},
					],
					assertions_pass: true,
					evaluators: [],
					latency_score: 0.9,
					overall: 0.79,
					policy_pass: true,
					prompt: "Explain topic: prompt engineering",
					response_text:
						"Prompt engineering is writing instructions for a model.",
					substring_match: 1,
					token_efficiency: 0.64,
				},
			],
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
		if (url.includes("/api/gateway/evals/run")) {
			return jsonResponse(EVAL_RESULT);
		}
		if (url.includes("/api/prompt-suites")) {
			if (url.endsWith("/pr_prompt_studio_proof")) {
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: "pr_prompt_studio_proof",
						name: "Promptfoo regression suite · proof",
						request: {},
						result: {
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
				savedRun = true;
				return jsonResponse({
					run: {
						created_at: Date.now(),
						id: "pr_prompt_studio_proof",
						name: "Promptfoo regression suite · proof",
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
									name: "Promptfoo regression suite · proof",
									suite_id: "ps_prompt_studio_proof",
								},
							]
						: [],
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
