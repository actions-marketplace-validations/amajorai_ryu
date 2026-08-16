import { expect, test } from "bun:test";
import {
	appendReasoningPart,
	appendTextPart,
	appendToolInputPart,
	appendToolOutputPart,
	readTodos,
	replaceTodoPart,
} from "../core/chatTranscript.ts";

test("keeps text, reasoning, tool status, and todo snapshots typed", () => {
	let parts = appendTextPart([], "answer");
	parts = appendReasoningPart(parts, "first");
	parts = appendReasoningPart(parts, " second");
	parts = appendToolInputPart(parts, "search", { query: "ryu" }, "tool-1");
	parts = appendToolOutputPart(parts, "ok", { count: 3 }, "tool-1");
	parts = replaceTodoPart(parts, [
		{ content: "Inspect", status: "completed" },
		{ content: "Ship", status: "in_progress" },
	]);

	expect(parts).toEqual([
		{ type: "text", text: "answer" },
		{ type: "reasoning", text: "first second" },
		{
			type: "tool",
			toolCallId: "tool-1",
			name: "search",
			status: "success",
			args: { query: "ryu" },
			result: { count: 3 },
		},
		{
			type: "todo",
			todos: [
				{ content: "Inspect", status: "completed" },
				{ content: "Ship", status: "in_progress" },
			],
		},
	]);
});

test("correlates interleaved tool outputs by tool call id", () => {
	let parts = appendToolInputPart([], "first", undefined, "call-1");
	parts = appendToolInputPart(parts, "second", undefined, "call-2");
	parts = appendToolOutputPart(parts, "ok", { result: 1 }, "call-1");
	parts = appendToolOutputPart(parts, "error", { result: 2 }, "call-2");

	expect(parts).toEqual([
		{
			type: "tool",
			toolCallId: "call-1",
			name: "first",
			status: "success",
			result: { result: 1 },
		},
		{
			type: "tool",
			toolCallId: "call-2",
			name: "second",
			status: "error",
			result: { result: 2 },
		},
	]);
});

test("filters malformed todo entries without losing valid plan items", () => {
	expect(
		readTodos({
			todos: [
				{ content: "valid", status: "pending" },
				null,
				{ content: 42, status: "pending" },
			],
		})
	).toEqual([{ content: "valid", status: "pending" }]);
});

test("applies interleaved tool results to their exact call IDs", () => {
	let parts = appendToolInputPart([], "first", undefined, "call-1");
	parts = appendToolInputPart(parts, "second", undefined, "call-2");
	parts = appendToolOutputPart(parts, "ok", { value: 1 }, "call-1");

	expect(parts).toEqual([
		{
			type: "tool",
			toolCallId: "call-1",
			name: "first",
			status: "success",
			result: { value: 1 },
		},
		{ type: "tool", toolCallId: "call-2", name: "second", status: "running" },
	]);
});
