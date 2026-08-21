import { expect, test } from "bun:test";
import {
	boundTerminalText,
	boundToolArguments,
	completedTodoCount,
	formatToolOutput,
	sanitizeTerminalText,
	TRANSCRIPT_LIMITS,
	todoStatusPresentation,
	toolArgumentsForPresentation,
} from "../core/transcriptPresentation.ts";

test("sanitizes terminal control sequences and keeps bounded text within both limits", () => {
	const presentation = boundTerminalText(
		"\u001b[31mfirst\u001b[0m\r\nsecond\nthird",
		{ label: "message", maxChars: 64, maxLines: 2 }
	);

	expect(presentation.truncated).toBe(true);
	expect(presentation.text).not.toContain("\u001b");
	expect(presentation.text).toContain("[message truncated:");
	expect(presentation.text.length).toBeLessThanOrEqual(64);
	expect(presentation.text.split("\n")).toHaveLength(2);
});

test("formats and bounds structured tool output without leaking control characters", () => {
	const output = formatToolOutput({
		status: "ok",
		stdout: `${"line\n".repeat(120)}\u001b[2J`,
	});

	expect(output).toBeDefined();
	expect(output?.length).toBeLessThanOrEqual(TRANSCRIPT_LIMITS.toolOutputChars);
	expect(output).not.toContain("\u001b");
	expect(output).toContain("[tool output truncated:");
});

test("bounds tool args and promotes result-supplied diffs for the Diff primitive", () => {
	const args = boundToolArguments({
		file_path: "src/example.ts",
		patch: "a\tline\n".repeat(200),
	});
	const withResultDiff = toolArgumentsForPresentation(
		"Edit",
		{ file_path: "src/example.ts" },
		{
			output: "--- src/example.ts\n+++ src/example.ts\n@@ -1 +1 @@\n-old\n+new",
		}
	);

	expect(args?.patch).toBeString();
	expect(String(args?.patch).length).toBeLessThanOrEqual(
		TRANSCRIPT_LIMITS.toolArgumentChars + 200
	);
	expect(withResultDiff?.patch).toContain("@@ -1 +1 @@");
});

test("uses readable todo status semantics with an ASCII fallback", () => {
	expect(todoStatusPresentation("completed")).toMatchObject({
		icon: "✓",
		kind: "completed",
		tone: "success",
	});
	expect(todoStatusPresentation("in_progress", false)).toMatchObject({
		icon: "[>]",
		kind: "in_progress",
		tone: "primary",
	});
	expect(todoStatusPresentation("blocked", false)).toMatchObject({
		icon: "[!]",
		kind: "error",
		tone: "error",
	});
	expect(
		completedTodoCount([
			{ status: "completed" },
			{ status: "in_progress" },
			{ status: "done" },
		])
	).toBe(2);
	expect(sanitizeTerminalText("a\tb\u0007")).toBe("a  b");
});
