import { describe, expect, test } from "bun:test";
import {
	buildVersions,
	extractAssistantText,
	isAcpAgent,
} from "./chat-message-selectors.ts";

describe("chat message selectors", () => {
	test("transport uses the server signal before legacy registry hints", () => {
		expect(isAcpAgent(null, [])).toBe(true);
		expect(isAcpAgent("unknown", [])).toBe(true);
		expect(isAcpAgent("acp:custom", [])).toBe(true);
		expect(
			isAcpAgent("agent", [
				{
					id: "agent",
					builtIn: true,
					transport: "openai_compat",
					engine: null,
				},
			])
		).toBe(false);
		expect(
			isAcpAgent("agent", [
				{ id: "agent", builtIn: false, transport: "acp", engine: "cloud" },
			])
		).toBe(true);
	});

	test("preserves chat's fallback for records without a transport", () => {
		for (const engine of [null, "", "acp:custom"]) {
			expect(
				isAcpAgent("agent", [
					{ id: "agent", builtIn: false, transport: null, engine },
				])
			).toBe(true);
		}
		expect(
			isAcpAgent("agent", [
				{ id: "agent", builtIn: false, transport: null, engine: "openai" },
			])
		).toBe(false);
		expect(
			isAcpAgent("agent", [
				{ id: "agent", builtIn: true, transport: null, engine: "openai" },
			])
		).toBe(true);
	});

	test("only real branch points get version pagers, preserving server order", () => {
		const ids = ["second", "first"];
		expect(
			buildVersions([
				{ id: "plain" },
				{ id: "single", siblingCount: 1, siblingIds: ["single"] },
				{ id: "missing-ids", siblingCount: 2 },
				{ id: "branch", siblingCount: 2, siblingIds: ids },
				{
					id: "selected",
					siblingCount: 3,
					siblingIndex: 2,
					siblingIds: ["a", "b", "c"],
				},
			])
		).toEqual({
			branch: { index: 0, count: 2, ids },
			selected: { index: 2, count: 3, ids: ["a", "b", "c"] },
		});
	});

	test("readback uses text parts and never narrates tool or reasoning payloads", () => {
		expect(
			extractAssistantText({
				content: "legacy",
				parts: [
					null,
					{ type: "text", text: " First " },
					{ type: "reasoning", text: "private reasoning" },
					{ type: "tool-result", text: "tool output" },
					{ type: "text", text: 123 },
					{ type: "text", text: "Second " },
				],
			})
		).toBe("First \n\nSecond");
		expect(
			extractAssistantText({ content: "legacy", parts: [{ type: "file" }] })
		).toBe("");
		expect(extractAssistantText({ content: " legacy ", parts: [] })).toBe(
			"legacy"
		);
		expect(extractAssistantText({})).toBe("");
	});
});
