export const TRANSCRIPT_LIMITS = {
	markdownChars: 12_000,
	markdownLines: 240,
	thinkingChars: 8000,
	thinkingLines: 120,
	toolArgumentChars: 4000,
	toolArgumentLines: 80,
	toolOutputChars: 6000,
	toolOutputLines: 80,
	todoChars: 240,
	todoLines: 4,
} as const;

const ANSI_ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: These escapes are the control characters being sanitized.
	/\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/g;
const UNSAFE_CONTROL_CHARACTER =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: These escapes are the control characters being sanitized.
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface BoundedTerminalText {
	omittedChars: number;
	omittedLines: number;
	text: string;
	truncated: boolean;
}

export interface BoundTerminalTextOptions {
	label?: string;
	maxChars: number;
	maxLines?: number;
}

export type TodoStatusKind = "pending" | "in_progress" | "completed" | "error";

export type TodoStatusTone = "muted" | "primary" | "success" | "error";

export interface TodoStatusPresentation {
	icon: string;
	kind: TodoStatusKind;
	label: string;
	tone: TodoStatusTone;
}

/** Remove terminal control sequences before external text reaches an OpenTUI node. */
export const sanitizeTerminalText = (value: string): string =>
	value
		.replace(/\r\n?/g, "\n")
		.replace(ANSI_ESCAPE_SEQUENCE, "")
		.replace(/\t/g, "  ")
		.replace(UNSAFE_CONTROL_CHARACTER, "");

const normalizedLimit = (value: number): number =>
	Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

const truncationMarker = (
	label: string,
	omittedChars: number,
	omittedLines: number
): string => {
	if (omittedLines > 0) {
		return `[${label} truncated: ${omittedLines} more ${omittedLines === 1 ? "line" : "lines"}]`;
	}
	return `[${label} truncated: ${omittedChars} more ${omittedChars === 1 ? "character" : "characters"}]`;
};

/** Bound both row count and character count while keeping a visible marker. */
export const boundTerminalText = (
	value: string,
	options: BoundTerminalTextOptions
): BoundedTerminalText => {
	const sanitized = sanitizeTerminalText(value);
	const maxChars = normalizedLimit(options.maxChars);
	const maxLines =
		options.maxLines === undefined
			? undefined
			: normalizedLimit(options.maxLines);
	const sourceLines = sanitized.split("\n");
	const lineLimited = maxLines !== undefined && sourceLines.length > maxLines;
	const initialLines = lineLimited
		? sourceLines.slice(0, maxLines)
		: sourceLines;
	const initialText = initialLines.join("\n");
	const charLimited = initialText.length > maxChars;

	if (!(lineLimited || charLimited)) {
		return {
			text: initialText,
			truncated: false,
			omittedChars: 0,
			omittedLines: 0,
		};
	}

	const omittedLines = lineLimited
		? sourceLines.length - initialLines.length
		: 0;
	const omittedChars = Math.max(0, sanitized.length - initialText.length);
	const label = sanitizeTerminalText(options.label ?? "text") || "text";
	const marker = truncationMarker(label, omittedChars, omittedLines);

	// Reserve the final line for the marker so maxLines remains a real terminal
	// bound rather than an approximate payload-only limit.
	const contentLines =
		maxLines === undefined
			? initialLines
			: initialLines.slice(0, Math.max(0, maxLines - 1));
	let content = contentLines.join("\n");
	const separatorLength = content.length > 0 ? 1 : 0;
	const markerText = marker.slice(0, maxChars);
	const contentBudget = Math.max(
		0,
		maxChars - separatorLength - markerText.length
	);
	content = content.slice(0, contentBudget);

	return {
		text: `${content}${content.length > 0 ? "\n" : ""}${markerText}`,
		truncated: true,
		omittedChars: Math.max(0, sanitized.length - content.length),
		omittedLines,
	};
};

const stringifyTerminalValue = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	if (value === undefined) {
		return "";
	}
	try {
		const serialized = JSON.stringify(value, null, 2);
		return serialized ?? String(value);
	} catch {
		return String(value);
	}
};

const MAX_OUTPUT_DEPTH = 4;
const MAX_OUTPUT_ENTRIES = 32;

const presentOutputValue = (value: unknown, depth: number): unknown => {
	if (typeof value === "string") {
		return boundTerminalText(value, {
			label: "tool output",
			maxChars: TRANSCRIPT_LIMITS.toolOutputChars,
			maxLines: TRANSCRIPT_LIMITS.toolOutputLines,
		}).text;
	}
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value;
	}
	if (depth >= MAX_OUTPUT_DEPTH) {
		return "[tool output depth truncated]";
	}
	if (Array.isArray(value)) {
		const values = value
			.slice(0, MAX_OUTPUT_ENTRIES)
			.map((item) => presentOutputValue(item, depth + 1));
		if (value.length > MAX_OUTPUT_ENTRIES) {
			values.push(`[${value.length - MAX_OUTPUT_ENTRIES} more items]`);
		}
		return values;
	}
	if (isRecord(value)) {
		const entries = Object.entries(value);
		const output: Record<string, unknown> = {};
		for (const [key, item] of entries.slice(0, MAX_OUTPUT_ENTRIES)) {
			output[sanitizeTerminalText(key).slice(0, 120)] = presentOutputValue(
				item,
				depth + 1
			);
		}
		if (entries.length > MAX_OUTPUT_ENTRIES) {
			output.__truncated__ = `[${entries.length - MAX_OUTPUT_ENTRIES} more fields]`;
		}
		return output;
	}
	return sanitizeTerminalText(String(value));
};

export const presentToolOutput = (
	value: unknown
): BoundedTerminalText | undefined => {
	if (value === undefined) {
		return undefined;
	}
	return boundTerminalText(
		stringifyTerminalValue(presentOutputValue(value, 0)),
		{
			label: "tool output",
			maxChars: TRANSCRIPT_LIMITS.toolOutputChars,
			maxLines: TRANSCRIPT_LIMITS.toolOutputLines,
		}
	);
};

export const formatToolOutput = (value: unknown): string | undefined =>
	presentToolOutput(value)?.text;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const MAX_ARGUMENT_DEPTH = 4;
const MAX_ARGUMENT_ENTRIES = 32;

const presentArgumentValue = (value: unknown, depth: number): unknown => {
	if (typeof value === "string") {
		return boundTerminalText(value, {
			label: "argument",
			maxChars: TRANSCRIPT_LIMITS.toolArgumentChars,
			maxLines: TRANSCRIPT_LIMITS.toolArgumentLines,
		}).text;
	}
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value;
	}
	if (depth >= MAX_ARGUMENT_DEPTH) {
		return "[argument depth truncated]";
	}
	if (Array.isArray(value)) {
		const values = value
			.slice(0, MAX_ARGUMENT_ENTRIES)
			.map((item) => presentArgumentValue(item, depth + 1));
		if (value.length > MAX_ARGUMENT_ENTRIES) {
			values.push(`[${value.length - MAX_ARGUMENT_ENTRIES} more items]`);
		}
		return values;
	}
	if (isRecord(value)) {
		const entries = Object.entries(value);
		const output: Record<string, unknown> = {};
		for (const [key, item] of entries.slice(0, MAX_ARGUMENT_ENTRIES)) {
			const safeKey = sanitizeTerminalText(key).slice(0, 120);
			output[safeKey] = presentArgumentValue(item, depth + 1);
		}
		if (entries.length > MAX_ARGUMENT_ENTRIES) {
			output.__truncated__ = `[${entries.length - MAX_ARGUMENT_ENTRIES} more fields]`;
		}
		return output;
	}
	return sanitizeTerminalText(String(value));
};

export const boundToolArguments = (
	args: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
	if (!args) {
		return undefined;
	}
	const bounded = presentArgumentValue(args, 0);
	return isRecord(bounded) ? bounded : undefined;
};

const DIFF_TOOL_NAMES = new Set(["Edit", "ApplyPatch", "edit", "apply_patch"]);

export const isDiffTool = (name: string): boolean => DIFF_TOOL_NAMES.has(name);

const looksLikeDiff = (value: string): boolean => {
	const lines = value.split("\n");
	const hasHeader = lines.some(
		(line) =>
			line.startsWith("diff ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			line.startsWith("@@ ")
	);
	const hasChangePair =
		lines.some((line) => line.startsWith("+")) &&
		lines.some((line) => line.startsWith("-"));
	return hasHeader || hasChangePair;
};

const findDiffText = (value: unknown, depth = 0): string | undefined => {
	if (depth > 3) {
		return undefined;
	}
	if (typeof value === "string") {
		return looksLikeDiff(value) ? value : undefined;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	for (const key of ["patch", "diff", "unified_diff", "unifiedDiff"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && looksLikeDiff(candidate)) {
			return candidate;
		}
	}
	for (const key of ["output", "result", "content", "text"]) {
		const nested = findDiffText(value[key], depth + 1);
		if (nested) {
			return nested;
		}
	}
	return undefined;
};

/** Add a result-supplied patch to the args shape consumed by the existing Diff primitive. */
export const toolArgumentsForPresentation = (
	name: string,
	args: Record<string, unknown> | undefined,
	result: unknown
): Record<string, unknown> | undefined => {
	const boundedArgs = boundToolArguments(args);
	if (!isDiffTool(name)) {
		return boundedArgs;
	}
	const diffText = findDiffText(result);
	const nestedArgs = boundedArgs?.rawInput;
	const hasDiffInput =
		boundedArgs?.patch ||
		boundedArgs?.diff ||
		(isRecord(nestedArgs) && (nestedArgs.patch || nestedArgs.diff));
	if (!diffText || hasDiffInput) {
		return boundedArgs;
	}
	if (boundedArgs && isRecord(nestedArgs)) {
		return boundToolArguments({
			...boundedArgs,
			rawInput: { ...nestedArgs, patch: diffText },
		});
	}
	return boundToolArguments({ ...(boundedArgs ?? {}), patch: diffText });
};

export const todoStatusPresentation = (
	status: string,
	unicode = true
): TodoStatusPresentation => {
	const normalized = status
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (["completed", "complete", "done"].includes(normalized)) {
		return {
			kind: "completed",
			icon: unicode ? "✓" : "[x]",
			label: "completed",
			tone: "success",
		};
	}
	if (["in_progress", "running", "active"].includes(normalized)) {
		return {
			kind: "in_progress",
			icon: unicode ? "•" : "[>]",
			label: "in progress",
			tone: "primary",
		};
	}
	if (["error", "failed", "blocked"].includes(normalized)) {
		return {
			kind: "error",
			icon: unicode ? "✗" : "[!]",
			label: normalized,
			tone: "error",
		};
	}
	return {
		kind: "pending",
		icon: unicode ? "○" : "[ ]",
		label: normalized || "pending",
		tone: "muted",
	};
};

export const completedTodoCount = (todos: { status: string }[]): number =>
	todos.filter(
		(todo) => todoStatusPresentation(todo.status).kind === "completed"
	).length;
