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
	context?: unknown;
	description: string;
	expected?: string;
	id?: string;
	inheritDefaultTest?: boolean;
	messages?: EvalMessage[];
	metadata: Record<string, unknown>;
	options: Record<string, unknown>;
	prompt?: string;
	provider?: string;
	providerOutput?: unknown;
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

export type PromptfooRelatedFiles = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function assertionValueText(value: unknown): string | null {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => assertionValueText(item) ?? JSON.stringify(item))
			.join(",");
	}
	if (isRecord(value)) {
		return JSON.stringify(value);
	}
	return null;
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
	const negatedKind = rawKind.startsWith("not_");
	const kind = negatedKind ? rawKind.slice("not_".length) : rawKind;
	const options = {
		...(negatedKind && typeof item.not !== "boolean" ? { not: true } : {}),
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
		...(typeof item.not === "boolean" ? { not: item.not } : {}),
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
	if (kind === "assert_set") {
		const nestedValue = item.assertions ?? item.value;
		const nested: unknown[] = Array.isArray(nestedValue) ? nestedValue : [];
		return withOptions({
			assertions: nested.flatMap((entry) => {
				const normalized = normalizeAssertion(entry);
				return normalized ? [normalized] : [];
			}),
			kind: "assert_set",
		});
	}
	if (
		[
			"llm_judge",
			"llm_rubric",
			"similar",
			"factuality",
			"context_faithfulness",
			"answer_relevance",
		].includes(kind)
	) {
		if (kind === "similar") {
			return withOptions({
				kind: "similar",
				value: assertionValueText(item.value ?? item.expected) ?? "",
			});
		}
		const rubricKind = kind as
			| "llm_judge"
			| "llm_rubric"
			| "factuality"
			| "context_faithfulness"
			| "answer_relevance";
		return withOptions({
			kind: rubricKind,
			rubric: asString(item.rubric ?? item.rubricPrompt ?? item.value),
		});
	}
	const valueText = assertionValueText(item.value ?? item.expected);
	if (valueText === null) {
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
		"contains_html",
		"contains_xml",
		"contains_sql",
		"levenshtein",
		"latency",
		"cost",
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
		context: item.context,
		description: asString(item.description ?? item.name, `Case ${index + 1}`),
		id: typeof item.id === "string" ? item.id : undefined,
		expected: typeof item.expected === "string" ? item.expected : undefined,
		inheritDefaultTest:
			item.defaultTest === false ||
			item.inheritDefaultTest === false ||
			item.skipDefaultTest === true
				? false
				: undefined,
		messages: messages.length > 0 ? messages : undefined,
		metadata: asRecord(item.metadata),
		options: asRecord(item.options),
		prompt: prompt || undefined,
		providerOutput: item.providerOutput ?? item.provider_output,
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

function fileReference(value: unknown): string | null {
	if (typeof value === "string" && value.startsWith("file://")) {
		return value.slice("file://".length);
	}
	if (isRecord(value) && typeof value.file === "string") {
		return value.file;
	}
	return null;
}

function selectedFileReference(
	value: unknown,
	relatedFiles: PromptfooRelatedFiles
): string | null {
	const explicit = fileReference(value);
	if (explicit) {
		return explicit;
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.replaceAll("\\", "/");
	return relatedFiles[value] !== undefined ||
		relatedFiles[normalized] !== undefined
		? value
		: relatedFiles[fileBasename(normalized)] === undefined
			? null
			: fileBasename(normalized);
}

function fileBasename(value: string): string {
	return value.replaceAll("\\", "/").split("/").at(-1) ?? value;
}

function relatedFileText(
	reference: string,
	relatedFiles: PromptfooRelatedFiles
): string {
	const normalized = reference.replaceAll("\\", "/");
	const text =
		relatedFiles[reference] ??
		relatedFiles[normalized] ??
		relatedFiles[fileBasename(normalized)];
	if (text === undefined) {
		throw new Error(
			`Referenced Promptfoo file "${reference}" is not in the selected files. Select the config together with its prompt/dataset files.`
		);
	}
	return text;
}

function directPromptText(text: string, reference: string): string {
	const extension = reference.toLowerCase().split(".").at(-1);
	if (extension === "txt" || extension === "md" || extension === "j2") {
		return text;
	}
	const parsed =
		extension === "yaml" || extension === "yml"
			? parseYaml(text)
			: JSON.parse(text);
	const prompt = normalizePromptfooConfig(parsed).prompts[0];
	if (prompt?.type === "chat") {
		return JSON.stringify(prompt.messages);
	}
	if (prompt?.content) {
		return prompt.content;
	}
	return text;
}

function parseStructuredFile(text: string, reference: string): unknown {
	const extension = reference.toLowerCase().split(".").at(-1);
	if (extension === "yaml" || extension === "yml") {
		return parseYaml(text);
	}
	return JSON.parse(text);
}

function resolveFileBackedConfig(
	value: unknown,
	relatedFiles: PromptfooRelatedFiles
): Record<string, unknown> {
	if (!isRecord(value)) {
		return {};
	}
	const resolved = structuredClone(value) as Record<string, unknown>;
	const defaultTestReference = selectedFileReference(
		resolved.defaultTest,
		relatedFiles
	);
	if (defaultTestReference) {
		const parsed = parseStructuredFile(
			relatedFileText(defaultTestReference, relatedFiles),
			defaultTestReference
		);
		if (isRecord(parsed)) {
			resolved.defaultTest = parsed;
		}
	}
	const prompts = resolved.prompts;
	if (Array.isArray(prompts)) {
		resolved.prompts = prompts.map((prompt) => {
			const reference = selectedFileReference(prompt, relatedFiles);
			if (!reference) {
				return prompt;
			}
			const text = relatedFileText(reference, relatedFiles);
			if (typeof prompt === "string") {
				return directPromptText(text, reference);
			}
			const object = Object.fromEntries(
				Object.entries(asRecord(prompt)).filter(([key]) => key !== "file")
			);
			object.content = directPromptText(text, reference);
			return object;
		});
	}
	const promptReference = selectedFileReference(resolved.prompt, relatedFiles);
	if (promptReference) {
		const text = relatedFileText(promptReference, relatedFiles);
		resolved.prompt = directPromptText(text, promptReference);
	}
	const tests = resolved.tests;
	const testsReference = selectedFileReference(tests, relatedFiles);
	if (testsReference) {
		const text = relatedFileText(testsReference, relatedFiles);
		resolved.tests = parsePromptfooFile(
			text,
			testsReference,
			relatedFiles
		).config.tests;
	} else if (Array.isArray(tests)) {
		resolved.tests = tests.flatMap((test) => {
			const reference = selectedFileReference(test, relatedFiles);
			if (!reference) {
				return [test];
			}
			const text = relatedFileText(reference, relatedFiles);
			return parsePromptfooFile(text, reference, relatedFiles).config.tests;
		});
	}
	return resolved;
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
	const providerValues =
		Array.isArray(raw.providers) && raw.providers.length > 0
			? raw.providers
			: Array.isArray(raw.targets)
				? raw.targets
				: [];
	const providers = providerValues.flatMap((provider) => {
		const id = providerId(provider);
		return id ? [id] : [];
	});
	return {
		...raw,
		...(isRecord(raw.defaultTest) ? { defaultTest: raw.defaultTest } : {}),
		prompts,
		providers,
		tests: testsRaw.map((test, index) => {
			const testRecord = asRecord(test);
			const skipDefault =
				testRecord.defaultTest === false ||
				testRecord.inheritDefaultTest === false ||
				testRecord.skipDefaultTest === true;
			return normalizeTest(
				defaultTest && !skipDefault
					? mergeDefaultTest(defaultTest, test)
					: test,
				index
			);
		}),
	};
}

function exportAssertion(assertion: Assertion): Record<string, unknown> {
	const options = assertion.options ?? {};
	const exportType = (kind: string): string =>
		`${options.not === true ? "not-" : ""}${kind.replaceAll("_", "-")}`;
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
		return { ...exportedOptions, type: exportType(assertion.kind) };
	}
	if (assertion.kind === "assert_set") {
		return {
			...exportedOptions,
			type: exportType("assert-set"),
			value: assertion.assertions.map(exportAssertion),
		};
	}
	if (
		assertion.kind === "llm_judge" ||
		assertion.kind === "llm_rubric" ||
		assertion.kind === "similar" ||
		assertion.kind === "factuality" ||
		assertion.kind === "context_faithfulness" ||
		assertion.kind === "answer_relevance"
	) {
		const type =
			assertion.kind === "llm_judge" || assertion.kind === "llm_rubric"
				? exportType("llm-rubric")
				: exportType(assertion.kind);
		if (assertion.kind === "similar") {
			return {
				...exportedOptions,
				type: exportType("similar"),
				value: "value" in assertion ? assertion.value : "",
			};
		}
		return {
			...exportedOptions,
			rubricPrompt: "rubric" in assertion ? assertion.rubric : "",
			type,
		};
	}
	return {
		...exportedOptions,
		type: exportType(assertion.kind),
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
function promptfooEvaluateOptions(
	config: PromptfooConfig
): Record<string, unknown> {
	const evaluateOptions = isRecord(config.evaluateOptions)
		? { ...config.evaluateOptions }
		: {};
	const runConfig = isRecord(config.run_config) ? config.run_config : {};
	for (const [source, target] of [
		["max_concurrency", "maxConcurrency"],
		["timeout_ms", "timeoutMs"],
		["cache", "cache"],
		["repeat", "repeat"],
		["tags", "tags"],
		["delay", "delay"],
	] as const) {
		if (runConfig[source] !== undefined) {
			evaluateOptions[target] = runConfig[source];
		}
	}
	return evaluateOptions;
}

export function toPromptfooConfig(
	config: PromptfooConfig
): Record<string, unknown> {
	const evaluateOptions = promptfooEvaluateOptions(config);
	const base = Object.fromEntries(
		Object.entries(config).filter(
			([key]) =>
				key !== "targets" && key !== "run_config" && key !== "evaluateOptions"
		)
	);
	return {
		...base,
		...(Object.keys(evaluateOptions).length > 0 ? { evaluateOptions } : {}),
		prompts: config.prompts.map(exportPrompt),
		providers: config.providers,
		tests: config.tests.map((test) => ({
			...(test.description ? { description: test.description } : {}),
			...(test.context === undefined ? {} : { context: test.context }),
			...(test.id ? { id: test.id } : {}),
			...(test.expected ? { expected: test.expected } : {}),
			...(test.inheritDefaultTest === false ? { defaultTest: false } : {}),
			...(test.messages ? { messages: test.messages } : {}),
			...(Object.keys(test.metadata).length > 0
				? { metadata: test.metadata }
				: {}),
			...(Object.keys(test.options).length > 0
				? { options: test.options }
				: {}),
			...(test.prompt ? { prompt: test.prompt } : {}),
			...(test.providerOutput === undefined
				? {}
				: { providerOutput: test.providerOutput }),
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
			if (
				[
					"assert",
					"context",
					"inheritDefaultTest",
					"metadata",
					"options",
					"providerOutput",
					"providers",
					"vars",
				].includes(header)
			) {
				try {
					result[header] = JSON.parse(value);
				} catch {
					result[header] = header === "providerOutput" ? value : {};
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
		"id",
		"description",
		"prompt",
		"messages",
		"vars",
		"expected",
		"context",
		"inheritDefaultTest",
		"assert",
		"metadata",
		"provider",
		"providers",
		"providerOutput",
		"options",
		"threshold",
	];
	const rows = config.tests.map((test) =>
		[
			test.id ?? "",
			test.description,
			test.prompt ?? "",
			test.messages ?? "",
			test.vars,
			test.expected ?? "",
			test.context ?? "",
			test.inheritDefaultTest === false ? false : "",
			test.assertions.map(exportAssertion),
			test.metadata,
			test.provider ?? "",
			test.providers,
			test.providerOutput ?? "",
			test.options,
			test.threshold ?? "",
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
	filename: string,
	relatedFiles: PromptfooRelatedFiles = {}
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
		config: normalizePromptfooConfig(
			resolveFileBackedConfig(value, relatedFiles)
		),
		format: extension === "yaml" || extension === "yml" ? "yaml" : "json",
	};
}
