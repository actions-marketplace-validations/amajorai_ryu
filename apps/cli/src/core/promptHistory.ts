import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const PROMPT_HISTORY_LIMIT = 100;

export interface PromptHistoryState {
	cursor: number;
	draft: string;
	entries: string[];
}

function homeDir(): string {
	return process.env.USERPROFILE || process.env.HOME || ".";
}

/** The TUI's prompt history file, shared across launches but not with Core. */
export function promptHistoryPath(): string {
	return join(homeDir(), ".ryu", "prompt-history.json");
}

function boundedEntries(entries: readonly string[]): string[] {
	return entries
		.filter((entry) => entry.trim().length > 0)
		.map((entry) => entry.trim())
		.slice(-PROMPT_HISTORY_LIMIT);
}

export function initialPromptHistory(
	entries: readonly string[] = []
): PromptHistoryState {
	return { entries: boundedEntries(entries), cursor: -1, draft: "" };
}

/** Read history defensively; a corrupt or unavailable file behaves like empty history. */
export function loadPromptHistory(
	path = promptHistoryPath()
): PromptHistoryState {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return initialPromptHistory(
			Array.isArray(parsed)
				? parsed.filter((entry): entry is string => typeof entry === "string")
				: []
		);
	} catch {
		return initialPromptHistory();
	}
}

/** Persisting is best-effort so a read-only home never breaks the composer. */
export function savePromptHistory(
	entries: readonly string[],
	path = promptHistoryPath()
): void {
	try {
		const directory = dirname(path);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		const temporaryPath = `${path}.${process.pid}.tmp`;
		writeFileSync(
			temporaryPath,
			JSON.stringify(boundedEntries(entries), null, 2),
			{ mode: 0o600 }
		);
		chmodSync(temporaryPath, 0o600);
		renameSync(temporaryPath, path);
		chmodSync(path, 0o600);
	} catch {
		// History is a convenience and must not prevent sending a prompt.
	}
}

export function recordPrompt(
	state: PromptHistoryState,
	prompt: string
): PromptHistoryState {
	const value = prompt.trim();
	if (value.length === 0) {
		return { ...state, cursor: -1, draft: "" };
	}
	const entries =
		state.entries.at(-1) === value
			? state.entries
			: [...state.entries, value].slice(-PROMPT_HISTORY_LIMIT);
	return { entries, cursor: -1, draft: "" };
}

export function previousPrompt(
	state: PromptHistoryState,
	currentValue: string
): { state: PromptHistoryState; value: string } {
	if (state.entries.length === 0) {
		return { state, value: currentValue };
	}
	const draft = state.cursor === -1 ? currentValue : state.draft;
	const cursor =
		state.cursor === -1
			? state.entries.length - 1
			: Math.max(0, state.cursor - 1);
	return {
		state: { ...state, cursor, draft },
		value: state.entries[cursor] ?? draft,
	};
}

export function nextPrompt(
	state: PromptHistoryState,
	currentValue: string
): { state: PromptHistoryState; value: string } {
	if (state.cursor === -1) {
		return { state, value: currentValue };
	}
	const cursor = state.cursor + 1;
	if (cursor >= state.entries.length) {
		return { state: { ...state, cursor: -1 }, value: state.draft };
	}
	return {
		state: { ...state, cursor },
		value: state.entries[cursor] ?? currentValue,
	};
}

export function resetPromptNavigation(
	state: PromptHistoryState
): PromptHistoryState {
	return state.cursor === -1 ? state : { ...state, cursor: -1, draft: "" };
}
