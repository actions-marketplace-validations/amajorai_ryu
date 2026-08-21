import { describe, expect, it } from "bun:test";
import { deriveTurnComposerProgress } from "./turn-composer-progress.ts";

describe("deriveTurnComposerProgress", () => {
	it("uses only the latest turn and exposes todo position plus file stats", () => {
		const result = deriveTurnComposerProgress([
			{ role: "user", parts: [{ type: "text", text: "old turn" }] },
			{
				role: "assistant",
				parts: [
					{ type: "tool-Write", input: { file_path: "old.ts", content: "x" } },
				],
			},
			{ role: "user", parts: [{ type: "text", text: "new turn" }] },
			{
				role: "assistant",
				parts: [
					{
						type: "tool-TodoWrite",
						input: {
							todos: [
								{ content: "Inspect", status: "completed" },
								{ content: "Build", status: "in_progress" },
								{ content: "Verify", status: "pending" },
							],
						},
					},
					{
						type: "tool-Edit",
						input: {
							file_path: "src/a.ts",
							old_string: "a\nb",
							new_string: "c\nd\ne",
						},
					},
				],
			},
		]);

		expect(result).toEqual({
			files: [{ path: "src/a.ts", insertions: 3, deletions: 2 }],
			insertions: 3,
			deletions: 2,
			todos: {
				current: 2,
				total: 3,
				items: [
					{ label: "Inspect", status: "completed" },
					{ label: "Build", status: "in_progress" },
					{ label: "Verify", status: "pending" },
				],
			},
		});
	});

	it("uses the TodoWrite snapshot and includes writes from the current streaming turn", () => {
		const result = deriveTurnComposerProgress([
			{ role: "user", parts: [{ type: "text", text: "old turn" }] },
			{
				role: "assistant",
				parts: [
					{
						type: "tool-TodoWrite",
						input: {
							todos: [{ content: "Stale todo", status: "pending" }],
						},
					},
				],
			},
			{ role: "user", parts: [{ type: "text", text: "current turn" }] },
			{
				role: "assistant",
				parts: [
					{
						type: "dynamic-tool",
						toolName: "update_plan",
						input: {
							plan: [{ step: "Not a todo", status: "in_progress" }],
						},
					},
					{
						type: "tool-TodoWrite",
						state: "input-streaming",
						input: {
							todos: [
								{ content: "Inspect", status: "completed" },
								{ content: "Build", status: "in_progress" },
							],
						},
					},
					{
						type: "tool-Write",
						state: "input-available",
						input: {
							file_path: "src/in-progress.ts",
							content: "first line\nsecond line",
						},
					},
				],
			},
		]);

		expect(result?.todos).toEqual({
			current: 2,
			total: 2,
			items: [
				{ label: "Inspect", status: "completed" },
				{ label: "Build", status: "in_progress" },
			],
		});
		expect(result?.files).toEqual([
			{ path: "src/in-progress.ts", insertions: 2, deletions: 0 },
		]);
	});

	it("does not invent composer progress from an update_plan part", () => {
		const result = deriveTurnComposerProgress([
			{ role: "user", parts: [{ type: "text", text: "current turn" }] },
			{
				role: "assistant",
				parts: [
					{
						type: "dynamic-tool",
						toolName: "update_plan",
						input: {
							plan: [{ step: "Not a todo", status: "in_progress" }],
						},
					},
				],
			},
		]);

		expect(result).toBeUndefined();
	});

	it("extracts every file from an apply_patch call", () => {
		const result = deriveTurnComposerProgress([
			{ role: "user", parts: [] },
			{
				role: "assistant",
				parts: [
					{
						type: "dynamic-tool",
						toolName: "apply_patch",
						input: {
							patch:
								"*** Update File: a.ts\n-old\n+new\n*** Add File: b.ts\n+one\n+two",
						},
					},
				],
			},
		]);

		expect(result?.files).toEqual([
			{ path: "a.ts", insertions: 1, deletions: 1 },
			{ path: "b.ts", insertions: 2, deletions: 0 },
		]);
	});
});
