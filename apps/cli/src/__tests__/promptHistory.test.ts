import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	initialPromptHistory,
	loadPromptHistory,
	nextPrompt,
	previousPrompt,
	recordPrompt,
	resetPromptNavigation,
	savePromptHistory,
} from "../core/promptHistory.ts";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "ryu-prompt-history-"));
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("round-trips bounded history and ignores corrupt files", () => {
	const path = join(tempDir, "nested", "history.json");
	let state = initialPromptHistory();
	for (let index = 0; index < 101; index += 1) {
		state = recordPrompt(state, `prompt-${index}`);
	}
	savePromptHistory(state.entries, path);

	expect(loadPromptHistory(path).entries).toHaveLength(100);
	expect(loadPromptHistory(path).entries[0]).toBe("prompt-1");

	Bun.write(path, "not-json");
	expect(loadPromptHistory(path).entries).toEqual([]);
});

test("navigates newest-to-oldest and restores the unsent draft", () => {
	let state = initialPromptHistory(["first", "second"]);
	let result = previousPrompt(state, "draft");
	expect(result.value).toBe("second");
	state = result.state;
	result = previousPrompt(state, result.value);
	expect(result.value).toBe("first");
	state = result.state;
	result = nextPrompt(state, result.value);
	expect(result.value).toBe("second");
	state = result.state;
	result = nextPrompt(state, result.value);
	expect(result.value).toBe("draft");
	expect(result.state.cursor).toBe(-1);
});

test("trims entries, suppresses adjacent duplicates, and resets navigation", () => {
	let state = initialPromptHistory();
	state = recordPrompt(state, "  hello  ");
	state = recordPrompt(state, "hello");
	expect(state.entries).toEqual(["hello"]);
	state = previousPrompt(state, "").state;
	expect(resetPromptNavigation(state).cursor).toBe(-1);
});

test("stores history with owner-only directory and file permissions", () => {
	const path = join(tempDir, "private", "history.json");
	savePromptHistory(["secret"], path);
	if (process.platform !== "win32") {
		expect(statSync(join(tempDir, "private")).mode & 0o777).toBe(0o700);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	}
});
