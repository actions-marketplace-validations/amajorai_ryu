import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type FetchLike, RyuNodeClient } from "./client.ts";
import {
	parseActionInputs,
	resolveTarget,
	validateOperationInputs,
} from "./input.ts";
import { type ActionRuntime, githubRuntime } from "./runtime.ts";
import type {
	ActionInputs,
	ActionResult,
	ChatRequest,
	NodeSnapshot,
	ToolRequest,
} from "./types.ts";

export interface RunnerOptions {
	environment?: Record<string, string | undefined>;
	fetchImpl?: FetchLike;
	runtime?: ActionRuntime;
	workingDirectory?: string;
}

function json(value: unknown): string {
	return JSON.stringify(value);
}

function outputText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return json(value);
}

function setNodeOutputs(runtime: ActionRuntime, node: NodeSnapshot): void {
	runtime.setOutput("node-url", node.url);
	runtime.setOutput("node-managed", String(node.info.managed));
	runtime.setOutput("node-version", node.health.version ?? "");
	runtime.setOutput("node-channel", node.health.channel ?? "");
	runtime.setOutput("health-json", json(node.health));
	runtime.setOutput("node-info-json", json(node.info));
}

function buildChatRequest(
	inputs: ActionInputs,
	conversationId: string
): ChatRequest {
	if (!inputs.prompt) {
		throw new Error("Input 'prompt' is required when operation is 'run'.");
	}
	const body: ChatRequest = {
		conversation_id: conversationId,
		enable_long_term: inputs.enableLongTerm,
		messages: [
			{
				content: [{ text: inputs.prompt, type: "text" }],
				role: "user",
			},
		],
		persist: inputs.persist,
	};
	if (inputs.agent) {
		body.agent_id = inputs.agent;
	}
	if (inputs.team) {
		body.team_id = inputs.team;
	}
	if (inputs.workflow) {
		body.workflow_id = inputs.workflow;
	}
	if (inputs.cwd) {
		body.cwd = inputs.cwd;
	}
	if (inputs.worktreeIsolation) {
		body.worktree_isolation = true;
	}
	if (inputs.inference) {
		body.inference = inputs.inference;
	}
	if (inputs.pluginFlags) {
		body.plugin_flags = inputs.pluginFlags;
	}
	return body;
}

function buildToolRequest(inputs: ActionInputs): ToolRequest {
	if (!(inputs.tool && inputs.agent)) {
		throw new Error(
			"Inputs 'tool' and 'agent' are required for a tool operation."
		);
	}
	const body: ToolRequest = {
		agent_id: inputs.agent,
		arguments: inputs.toolArguments,
		tool: inputs.tool,
	};
	if (inputs.userId) {
		body.user_id = inputs.userId;
	}
	return body;
}

async function writeResponseFile(
	path: string,
	text: string,
	workingDirectory = process.cwd()
): Promise<void> {
	const outputPath = resolve(workingDirectory, path);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, text, "utf8");
}

async function writeSummary(
	inputs: ActionInputs,
	node: NodeSnapshot,
	result: ActionResult,
	environment: Record<string, string | undefined>
): Promise<void> {
	const summaryPath = environment.GITHUB_STEP_SUMMARY;
	if (!(inputs.writeSummary && summaryPath)) {
		return;
	}
	const lines = [
		"## Ryu GitHub Action",
		"",
		`- Operation: \`${result.operation}\``,
		`- Target: \`${node.mode}\` · managed=${node.info.managed}`,
		`- Node: \`${node.url}\``,
		`- Version: \`${node.health.version ?? "unknown"}\``,
	];
	if (result.conversationId) {
		lines.push(`- Conversation: \`${result.conversationId}\``);
	}
	if (result.runId) {
		lines.push(`- Run: \`${result.runId}\``);
	}
	lines.push(`- Response characters: ${result.text.length}`);
	lines.push(`- Tool events: ${result.toolEvents.length}`);
	lines.push("");
	await appendFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function exportNodeEnvironment(
	runtime: ActionRuntime,
	node: NodeSnapshot,
	token: string | null
): void {
	runtime.exportVariable("RYU_CORE_URL", node.url);
	runtime.exportVariable("RYU_NODE_URL", node.url);
	if (token) {
		runtime.setSecret(token);
		runtime.exportVariable("RYU_CORE_TOKEN", token);
		runtime.exportVariable("RYU_NODE_TOKEN", token);
	}
}

function setResultOutputs(runtime: ActionRuntime, result: ActionResult): void {
	runtime.setOutput("response", result.text);
	runtime.setOutput("result-json", json(result.result));
	runtime.setOutput("conversation-id", result.conversationId ?? "");
	runtime.setOutput("run-id", result.runId ?? "");
	runtime.setOutput("tool-calls", json(result.toolEvents));
}

export async function executeAction(
	options: RunnerOptions = {}
): Promise<ActionResult> {
	const runtime = options.runtime ?? githubRuntime;
	const environment = options.environment ?? process.env;
	const inputs = parseActionInputs({ get: runtime.getInput });
	validateOperationInputs(inputs);
	const target = resolveTarget(inputs, environment);
	if (target.token) {
		runtime.setSecret(target.token);
	}
	runtime.info(`Connecting to Ryu ${target.mode} node at ${target.url}.`);
	const client = new RyuNodeClient(target, options.fetchImpl);
	const node = await client.validate(target.mode, inputs.timeoutMs);
	setNodeOutputs(runtime, node);
	if (inputs.exportEnv) {
		exportNodeEnvironment(runtime, node, target.token);
	}

	const base: ActionResult = {
		conversationId: null,
		node,
		operation: inputs.operation,
		result: null,
		runId: null,
		text: "",
		toolEvents: [],
	};
	if (inputs.operation === "setup") {
		setResultOutputs(runtime, base);
		await writeSummary(inputs, node, base, environment);
		return base;
	}

	if (inputs.operation === "run") {
		const conversationId = inputs.conversationId ?? crypto.randomUUID();
		const chatResult = await client.runChat(
			buildChatRequest(inputs, conversationId),
			inputs.timeoutMs
		);
		const result: ActionResult = {
			...base,
			conversationId: chatResult.conversationId,
			result: chatResult,
			runId: chatResult.runId,
			text: chatResult.text,
			toolEvents: chatResult.toolEvents,
		};
		if (inputs.responseFile) {
			await writeResponseFile(
				inputs.responseFile,
				result.text,
				options.workingDirectory
			);
		}
		setResultOutputs(runtime, result);
		await writeSummary(inputs, node, result, environment);
		return result;
	}

	const toolResult = await client.callTool(
		buildToolRequest(inputs),
		inputs.timeoutMs
	);
	if (!toolResult.ok) {
		throw new Error(toolResult.error ?? "Ryu tool call was denied or failed.");
	}
	const result: ActionResult = {
		...base,
		result: toolResult,
		text: outputText(toolResult.output),
	};
	if (inputs.responseFile) {
		await writeResponseFile(
			inputs.responseFile,
			result.text,
			options.workingDirectory
		);
	}
	setResultOutputs(runtime, result);
	await writeSummary(inputs, node, result, environment);
	return result;
}

export function buildChatRequestForTest(
	inputs: ActionInputs,
	conversationId: string
): ChatRequest {
	return buildChatRequest(inputs, conversationId);
}

export function buildToolRequestForTest(inputs: ActionInputs): ToolRequest {
	return buildToolRequest(inputs);
}
