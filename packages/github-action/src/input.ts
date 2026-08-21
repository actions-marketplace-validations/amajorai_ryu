import type {
	ActionInputs,
	Operation,
	ResolvedTarget,
	TargetMode,
} from "./types.ts";

export interface InputReader {
	get(name: string): string;
}

const TARGETS = new Set<TargetMode>(["auto", "self-hosted", "managed"]);
const OPERATIONS = new Set<Operation>(["setup", "run", "tool"]);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function clean(value: string | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

function booleanInput(
	reader: InputReader,
	name: string,
	fallback: boolean
): boolean {
	const value = clean(reader.get(name));
	if (value === null) {
		return fallback;
	}
	if (value === "true" || value === "1" || value === "yes") {
		return true;
	}
	if (value === "false" || value === "0" || value === "no") {
		return false;
	}
	throw new Error(`Input '${name}' must be true or false.`);
}

function jsonInput(reader: InputReader, name: string): unknown {
	const value = clean(reader.get(name));
	if (value === null) {
		return null;
	}
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw new Error(
			`Input '${name}' must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function recordInput(
	reader: InputReader,
	name: string
): Record<string, unknown> | null {
	const value = jsonInput(reader, name);
	if (value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Input '${name}' must contain a JSON object.`);
	}
	return value as Record<string, unknown>;
}

function booleanRecordInput(
	reader: InputReader,
	name: string
): Record<string, boolean> | null {
	const record = recordInput(reader, name);
	if (record === null) {
		return null;
	}
	for (const [key, value] of Object.entries(record)) {
		if (typeof value !== "boolean") {
			throw new Error(`Input '${name}' field '${key}' must be a boolean.`);
		}
	}
	return record as Record<string, boolean>;
}

function positiveIntegerInput(
	reader: InputReader,
	name: string,
	fallback: number
): number {
	const value = clean(reader.get(name));
	if (value === null) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Input '${name}' must be a positive integer.`);
	}
	return parsed;
}

function enumInput<T extends string>(
	reader: InputReader,
	name: string,
	allowed: ReadonlySet<T>,
	fallback: T
): T {
	const value = clean(reader.get(name)) ?? fallback;
	if (!allowed.has(value as T)) {
		throw new Error(
			`Input '${name}' must be one of: ${Array.from(allowed).join(", ")}.`
		);
	}
	return value as T;
}

export function parseActionInputs(reader: InputReader): ActionInputs {
	const operation = enumInput(reader, "operation", OPERATIONS, "setup");
	const target = enumInput(reader, "target", TARGETS, "auto");
	const toolArguments = jsonInput(reader, "tool-arguments") ?? {};

	return {
		agent: clean(reader.get("agent")),
		conversationId: clean(reader.get("conversation-id")),
		cwd: clean(reader.get("cwd")),
		enableLongTerm: booleanInput(reader, "enable-long-term", false),
		exportEnv: booleanInput(reader, "export-env", true),
		inference: recordInput(reader, "inference"),
		managedNodeToken: clean(reader.get("managed-node-token")),
		managedNodeUrl: clean(reader.get("managed-node-url")),
		nodeToken: clean(reader.get("node-token")),
		nodeUrl: clean(reader.get("node-url")),
		operation,
		persist: booleanInput(reader, "persist", false),
		pluginFlags: booleanRecordInput(reader, "plugin-flags"),
		prompt: clean(reader.get("prompt")),
		responseFile: clean(reader.get("response-file")),
		target,
		team: clean(reader.get("team")),
		timeoutMs: positiveIntegerInput(reader, "timeout-ms", DEFAULT_TIMEOUT_MS),
		tool: clean(reader.get("tool")),
		toolArguments,
		userId: clean(reader.get("user-id")),
		workflow: clean(reader.get("workflow")),
		worktreeIsolation: booleanInput(reader, "worktree-isolation", false),
		writeSummary: booleanInput(reader, "write-summary", true),
	};
}

function pick(...values: Array<string | null | undefined>): string | null {
	for (const value of values) {
		const selected = clean(value ?? undefined);
		if (selected !== null) {
			return selected;
		}
	}
	return null;
}

export function normalizeNodeUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Ryu node URL is invalid: '${value}'.`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Ryu node URL must use http or https.");
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error(
			"Ryu node URL must not include credentials, query parameters, or a fragment."
		);
	}
	const pathname = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.protocol}//${parsed.host}${pathname}`;
}

export function resolveTarget(
	inputs: Pick<
		ActionInputs,
		"managedNodeToken" | "managedNodeUrl" | "nodeToken" | "nodeUrl" | "target"
	>,
	environment: Record<string, string | undefined> = process.env
): ResolvedTarget {
	const managed = {
		token: pick(inputs.managedNodeToken, environment.RYU_MANAGED_NODE_TOKEN),
		url: pick(inputs.managedNodeUrl, environment.RYU_MANAGED_NODE_URL),
	};
	const selfHosted = {
		token: pick(inputs.nodeToken, environment.RYU_CORE_TOKEN),
		url: pick(inputs.nodeUrl, environment.RYU_CORE_URL),
	};
	let selected: { token: string | null; url: string | null };
	if (inputs.target === "managed") {
		selected = managed;
	} else if (inputs.target === "self-hosted") {
		selected = selfHosted;
	} else if (inputs.nodeUrl !== null) {
		selected = selfHosted;
	} else if (inputs.managedNodeUrl !== null) {
		selected = managed;
	} else if (environment.RYU_CORE_URL) {
		selected = selfHosted;
	} else {
		selected = managed;
	}

	if (selected.url === null) {
		throw new Error(
			"No Ryu node URL was provided. Set the node-url input or RYU_CORE_URL."
		);
	}

	return {
		mode: inputs.target,
		token: selected.token,
		url: normalizeNodeUrl(selected.url),
	};
}

export function validateOperationInputs(inputs: ActionInputs): void {
	if (inputs.operation === "run") {
		if (!inputs.prompt) {
			throw new Error("Input 'prompt' is required when operation is 'run'.");
		}
		const selectors = [inputs.agent, inputs.team, inputs.workflow].filter(
			(value): value is string => value !== null
		);
		if (selectors.length > 1) {
			throw new Error(
				"Inputs 'agent', 'team', and 'workflow' are mutually exclusive for a run."
			);
		}
	}
	if (inputs.operation === "tool") {
		if (!inputs.tool) {
			throw new Error("Input 'tool' is required when operation is 'tool'.");
		}
		if (!inputs.agent) {
			throw new Error(
				"Input 'agent' is required when operation is 'tool' because Core gates tool calls by agent allowlist."
			);
		}
	}
}
