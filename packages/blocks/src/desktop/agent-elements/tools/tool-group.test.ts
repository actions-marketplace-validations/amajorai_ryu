import { describe, expect, it } from "bun:test";
import { isToolActivityGroupCandidate } from "./tool-grouping.ts";

const collapsed = { expandCommands: false, expandFileEdits: false };

describe("isToolActivityGroupCandidate", () => {
	it("groups ordinary chronological actions", () => {
		expect(
			isToolActivityGroupCandidate(
				{ state: "output-available", type: "tool-Read" },
				collapsed
			)
		).toBe(true);
		expect(
			isToolActivityGroupCandidate(
				{ state: "output-available", type: "tool-Grep" },
				collapsed
			)
		).toBe(true);
	});

	it("keeps rich and interactive surfaces standalone", () => {
		for (const type of [
			"tool-Agent",
			"tool-Question",
			"tool-Thinking",
			"tool-WebSearch",
			"dynamic-tool",
		]) {
			expect(
				isToolActivityGroupCandidate(
					{ state: "output-available", type },
					collapsed
				)
			).toBe(false);
		}
	});

	it("honours expanded file and command preferences", () => {
		expect(
			isToolActivityGroupCandidate(
				{ state: "output-available", type: "tool-Edit" },
				{ ...collapsed, expandFileEdits: true }
			)
		).toBe(false);
		expect(
			isToolActivityGroupCandidate(
				{ state: "output-available", type: "tool-Bash" },
				{ ...collapsed, expandCommands: true }
			)
		).toBe(false);
	});

	it("never hides failed tools in a group", () => {
		expect(
			isToolActivityGroupCandidate(
				{ state: "output-error", type: "tool-Read" },
				collapsed
			)
		).toBe(false);
		expect(
			isToolActivityGroupCandidate(
				{
					output: { success: false },
					state: "output-available",
					type: "tool-Grep",
				},
				collapsed
			)
		).toBe(false);
	});
});
