import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { Assertion, EvalMessage } from "@/src/lib/api/gateway.ts";

export type PromptfooFormat = "csv" | "json" | "jsonl" | "yaml";

export interface PromptfooPrompt {
	content: string;
	id: string;
	messages: EvalMessage[];
	name: string;
	type: "chat" | "text";
}

export interface PromptfooTest {
	assertions: Assertion[];
	description: string;
	expected?: string;
	messages?: EvalMessage[];
	metadata: Record<string, unknown>;
	options: Record<string, unknown>;
	prompt?: string;
	provider?: string;
	providers: string[];
	threshold?: number;
	vars: Record<string, unknown>;
}

export interface PromptfooConfig {
	defaultTest?: Record<string, unknown>;
	prompts: PromptfooPrompt[];
	providers: string[];
	tests: PromptfooTest[];
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function asMessages(value: unknown): EvalMessage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}
		const role = asString(item.role, "user");
		if (!["assistant", "system", "user"].includes(role)) {
			return [];
		}
		return [
			{
				content: asString(item.content),
				role: role as EvalMessage["role"],
			},
		];
	});
}

function slug(value: string, fallback: string): string {
	const result = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return result || fallback;
}

function normalizePrompt(value: unknown, index: number): PromptfooPrompt {
	if (typeof value === "string") {
		return {
			content: value,
			id: `prompt-${index + 1}`,
			messages: [],
			name: `Prompt ${index + 1}`,
			type: "text",
		};
	}
	const item = asRecord(value);
	const messages = asMessages(item.messages);
	const content = asString(
		item.content ?? item.prompt ?? item.template ?? item.source
	);
	const name = asString(item.name ?? item.label, `Prompt ${index + 1}`);
	return {
		content,
		id: asString(item.id, slug(name, `prompt-${index + 1}`)),
		messages,
		name,
		type: messages.length > 0 || item.type === "chat" ? "chat" : "text",
	};
}

function normalizeAssertion(value: unknown): Assertion | null {
	if (typeof value === "string") {
		return { kind: "contains", value };
	}
	const item = asRecord(value);
	const rawKind = asString(item.kind ?? item.type).replaceAll("-", "_");
	const kind = rawKind === "llm_rubric" ? "llm_rubric" : rawKind;
	const options = {
		...(typeof item.threshold === "number"
			? { threshold: item.threshold }
			: {}),
		...(typeof item.weight === "number" ? { weight: item.weight } : {}),
		...(typeof item.provider === "string" ? { provider: item.provider } : {}),
		...(typeof item.rubric_prompt === "string"
			? { rubric_prompt: item.rubric_prompt }
			: typeof item.rubricPrompt === "string"
				? { rubric_prompt: item.rubricPrompt }
				: {}),
		...(typeof item.transform === "string"
			? { transform: item.transform }
			: {}),
		...(typeof item.metric === "string" ? { metric: item.metric } : {}),
		...(isRecord(item.config) ? { config: item.config } : {}),
	};
	const withOptions = <T extends Assertion>(assertion: T): T =>
		Object.keys(options).length > 0
			? ({ ...assertion, options } as T)
			: assertion;
	if (
		[
			"json_valid",
			"is_json",
			"is_html",
			"is_xml",
			"is_sql",
			"is_refusal",
		].includes(kind)
	) {
		return withOptions({
			kind: kind as
				| "json_valid"
				| "is_json"
				| "is_html"
				| "is_xml"
				| "is_sql"
				| "is_refusal",
		});
	}
	if (
		[
			"llm_judge",
			"llm_rubric",
			"factuality",
			"context_faithfulness",
			"answer_relevance",
		].includes(kind)
	) {
		return withOptions({
			kind: kind as
				| "llm_judge"
				| "llm_rubric"
				| "factuality"
				| "context_faithfulness"
				| "answer_relevance",
			rubric: asString(item.rubric ?? item.rubricPrompt ?? item.value),
		});
	}
	const valueText = item.value ?? item.expected;
	if (typeof valueText !== "string") {
		return null;
	}
	const supported = [
		"contains",
		"not_contains",
		"equals",
		"regex",
		"icontains",
		"starts_with",
		"contains_any",
		"contains_all",
		"icontains_any",
		"icontains_all",
		"contains_json",
		"moderation",
		"javascript",
		"python",
		"ruby",
		"webhook",
	] as const;
	if (!supported.includes(kind as (typeof supported)[number])) {
		return null;
	}
	return withOptions({
		kind: kind as (typeof supported)[number],
		value: valueText,
	});
}

function normalizeTest(value: unknown, index: number): PromptfooTest {
	const item = asRecord(value);
	const rawAssertions = item.assertions ?? item.assert ?? item.assertion;
	const assertionValues = Array.isArray(rawAssertions)
		? rawAssertions
		: rawAssertions === undefined
			? []
			: [rawAssertions];
	const assertions = assertionValues.flatMap((assertion) => {
		const normalized = normalizeAssertion(assertion);
		return normalized ? [normalized] : [];
	});
	const prompt = asString(item.prompt ?? item.input);
	const messages = asMessages(item.messages);
	const providers = Array.isArray(item.providers)
		? item.providers.filter(
				(provider): provider is string => typeof provider === "string"
			)
		: [];
	const provider =
		typeof item.provider === "string" ? item.provider : undefined;
	if (provider && !providers.includes(provider)) {
		providers.unshift(provider);
	}
	const threshold =
		typeof item.threshold === "number" ? item.threshold : undefined;
	return {
		assertions,
		description: asString(item.description ?? item.name, `Case ${index + 1}`),
		expected: typeof item.expected === "string" ? item.expected : undefined,
		messages: messages.length > 0 ? messages : undefined,
		metadata: asRecord(item.metadata),
		options: asRecord(item.options),
		prompt: prompt || undefined,
		provider,
		providers,
		threshold,
		vars: asRecord(item.vars),
	};
}

function mergeDefaultTest(
	defaultTest: Record<string, unknown>,
	test: unknown
): Record<string, unknown> {
	const merged = { ...defaultTest, ...asRecord(test) };
	if (isRecord(defaultTest.vars) && isRecord(asRecord(test).vars)) {
		merged.vars = {
			...asRecord(defaultTest.vars),
			...asRecord(asRecord(test).vars),
		};
	}
	return merged;
}

function providerId(value: unknown): string | null {
	if (typeof value === "string") {
		return value;
	}
	if (isRecord(value)) {
		const id = value.id ?? value.name ?? value.provider;
		return typeof id === "string" ? id : null;
	}
	return null;
}

/** Normalize a Promptfoo YAML/JSON object into the editor's stable shape. */
export function normalizePromptfooConfig(value: unknown): PromptfooConfig {
	const raw = asRecord(value);
	const promptsRaw = Array.isArray(raw.prompts) ? raw.prompts : [];
	const testsRaw = Array.isArray(raw.tests) ? raw.tests : [];
	const defaultTest = isRecord(raw.defaultTest) ? raw.defaultTest : undefined;
	const prompts =
		promptsRaw.length > 0
			? promptsRaw.map(normalizePrompt)
			: [normalizePrompt(raw.prompt ?? "", 0)];
	const providers = Array.isArray(raw.providers)
		? raw.providers.flatMap((provider) => {
				const id = providerId(provider);
				return id ? [id] : [];
			})
		: [];
	return {
		...raw,
		...(isRecord(raw.defaultTest) ? { defaultTest: raw.defaultTest } : {}),
		prompts,
		providers,
		tests: testsRaw.map((test, index) =>
			normalizeTest(
				defaultTest ? mergeDefaultTest(defaultTest, test) : test,
				index
			)
		),
	};
}

function assertionType(kind: string): string {
	return kind.replaceAll("_", "-");
}

function exportAssertion(assertion: Assertion): Record<string, unknown> {
	const options = assertion.options ?? {};
	const exportedOptions = {
		...(options.threshold === undefined
			? {}
			: { threshold: options.threshold }),
		...(options.weight === undefined ? {} : { weight: options.weight }),
		...(options.provider ? { provider: options.provider } : {}),
		...(options.rubric_prompt ? { rubricPrompt: options.rubric_prompt } : {}),
		...(options.transform ? { transform: options.transform } : {}),
		...(options.metric ? { metric: options.metric } : {}),
		...(options.config ? { config: options.config } : {}),
	};
	if (
		[
			"json_valid",
			"is_json",
			"is_html",
			"is_xml",
			"is_sql",
			"is_refusal",
		].includes(assertion.kind)
	) {
		return { ...exportedOptions, type: assertionType(assertion.kind) };
	}
	if (
		assertion.kind === "llm_judge" ||
		assertion.kind === "llm_rubric" ||
		assertion.kind === "factuality" ||
		assertion.kind === "context_faithfulness" ||
		assertion.kind === "answer_relevance"
	) {
		const type =
			assertion.kind === "llm_judge" || assertion.kind === "llm_rubric"
				? "llm-rubric"
				: assertionType(assertion.kind);
		return {
			...exportedOptions,
			rubricPrompt: "rubric" in assertion ? assertion.rubric : "",
			type,
		};
	}
	return {
		...exportedOptions,
		type: assertionType(assertion.kind),
		value: "value" in assertion ? assertion.value : "",
	};
}

function exportPrompt(
	prompt: PromptfooPrompt
): string | Record<string, unknown> {
	if (prompt.type === "chat") {
		return {
			id: prompt.id,
			messages: prompt.messages,
			name: prompt.name,
		};
	}
	return prompt.content;
}

/** Convert the normalized editor state back to a Promptfoo-compatible config. */
export function toPromptfooConfig(
	config: PromptfooConfig
): Record<string, unknown> {
	return {
		...config,
		prompts: config.prompts.map(exportPrompt),
		providers: config.providers,
		tests: config.tests.map((test) => ({
			...(test.description ? { description: test.description } : {}),
			...(test.expected ? { expected: test.expected } : {}),
			...(test.messages ? { messages: test.messages } : {}),
			...(Object.keys(test.metadata).length > 0
				? { metadata: test.metadata }
				: {}),
			...(Object.keys(test.options).length > 0
				? { options: test.options }
				: {}),
			...(test.prompt ? { prompt: test.prompt } : {}),
			...(test.providers.length > 0 ? { providers: test.providers } : {}),
			...(test.provider ? { provider: test.provider } : {}),
			...(test.threshold === undefined ? {} : { threshold: test.threshold }),
			vars: test.vars,
			assert: test.assertions.map(exportAssertion),
		})),
	};
}

function parseCsv(text: string): Record<string, unknown>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];
		if (char === '"' && quoted && next === '"') {
			cell += '"';
			index += 1;
		} else if (char === '"') {
			quoted = !quoted;
		} else if (char === "," && !quoted) {
			row.push(cell);
			cell = "";
		} else if ((char === "\n" || char === "\r") && !quoted) {
			if (char === "\r" && next === "\n") {
				index += 1;
			}
			row.push(cell);
			cell = "";
			if (row.some((value) => value.length > 0)) {
				rows.push(row);
			}
			row = [];
		} else {
			cell += char;
		}
	}
	row.push(cell);
	if (row.some((value) => value.length > 0)) {
		rows.push(row);
	}
	const headers = rows.shift() ?? [];
	return rows.map((values) => {
		const result: Record<string, unknown> = {};
		headers.forEach((header, index) => {
			const value = values[index] ?? "";
			if (header === "vars" || header === "metadata") {
				try {
					result[header] = JSON.parse(value);
				} catch {
					result[header] = {};
				}
			} else {
				result[header] = value;
			}
		});
		return result;
	});
}

function csvCell(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(config: PromptfooConfig): string {
	const headers = [
		"description",
		"prompt",
		"messages",
		"vars",
		"expected",
		"assert",
		"metadata",
	];
	const rows = config.tests.map((test) =>
		[
			test.description,
			test.prompt ?? "",
			test.messages ?? "",
			test.vars,
			test.expected ?? "",
			test.assertions.map(exportAssertion),
			test.metadata,
		]
			.map(csvCell)
			.join(",")
	);
	return [headers.join(","), ...rows].join("\n");
}

export function serializePromptfooConfig(
	config: PromptfooConfig,
	format: PromptfooFormat
): string {
	const exported = toPromptfooConfig(config);
	if (format === "yaml") {
		return stringifyYaml(exported);
	}
	if (format === "jsonl") {
		const tests = Array.isArray(exported.tests) ? exported.tests : [];
		return tests.map((test) => JSON.stringify(test)).join("\n");
	}
	if (format === "csv") {
		return toCsv(config);
	}
	return JSON.stringify(exported, null, 2);
}

/** Parse Promptfoo config files and dataset files accepted by the editor. */
export function parsePromptfooFile(
	text: string,
	filename: string
): { config: PromptfooConfig; format: PromptfooFormat } {
	const extension = filename.toLowerCase().split(".").at(-1);
	if (extension === "txt" || extension === "md" || extension === "j2") {
		return {
			config: normalizePromptfooConfig({ prompts: [text], tests: [] }),
			format: "json",
		};
	}
	if (extension === "csv") {
		return {
			config: normalizePromptfooConfig({ tests: parseCsv(text) }),
			format: "csv",
		};
	}
	if (extension === "jsonl" || extension === "ndjson") {
		const tests = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		return {
			config: normalizePromptfooConfig({ tests }),
			format: "jsonl",
		};
	}
	const value =
		extension === "yaml" || extension === "yml"
			? parseYaml(text)
			: JSON.parse(text);
	return {
		config: normalizePromptfooConfig(value),
		format: extension === "yaml" || extension === "yml" ? "yaml" : "json",
	};
}
