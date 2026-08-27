import { describe, expect, it } from "bun:test";
import { hydrateHistoryMessage } from "./chat-history-hydrate.ts";

const NOW = 1_700_000_000_000;
const JUST_NOW = NOW - 1000;
const LONG_AGO = NOW - 60_000;

function textOf(parts: unknown[]): string[] {
	return parts.map((p) => (p as { text?: string }).text ?? "");
}

describe("hydrateHistoryMessage", () => {
	it("prefers structured parts over flat content", () => {
		const parts = [
			{
				input: undefined,
				state: "input-streaming" as const,
				toolCallId: "t1",
				toolName: "Read",
				type: "dynamic-tool" as const,
			},
		];
		const out = hydrateHistoryMessage(
			{
				id: "m1",
				role: "assistant",
				content: "flattened",
				parts,
				timestamp: JUST_NOW,
			},
			NOW
		);
		expect(out.parts).toEqual(parts);
		expect(out._interrupted).toBeUndefined();
	});

	it("builds a single text part when Core has no parts", () => {
		const out = hydrateHistoryMessage(
			{ id: "m2", role: "user", content: "hello", timestamp: JUST_NOW },
			NOW
		);
		expect(out.parts).toEqual([{ type: "text", text: "hello" }]);
	});

	it("preserves Core-owned widget provenance for a reload", () => {
		const out = hydrateHistoryMessage(
			{
				content: "Open the selected row",
				id: "widget-follow-up",
				originServer: "com.ryu.example",
				role: "user",
				source: "widget",
				timestamp: JUST_NOW,
				widgetInstanceId: "instance-1",
			},
			NOW
		);
		expect(out.source).toBe("widget");
		expect(out.originServer).toBe("com.ryu.example");
		expect(out.widgetInstanceId).toBe("instance-1");
	});

	it("flags a truncated reply without touching the text that survived", () => {
		const out = hydrateHistoryMessage(
			{
				id: "m3",
				role: "assistant",
				content: "Sure — here is the fi",
				interrupted: true,
				timestamp: JUST_NOW,
			},
			NOW
		);
		// The surviving text is the ONLY text part. The interruption is metadata
		// (`_interrupted`), which the transcript draws as a marker under the turn —
		// it is deliberately NOT spliced into the reply as an extra sentence, so it
		// cannot be copied out with the answer or replayed to the model.
		expect(textOf(out.parts)).toEqual(["Sure — here is the fi"]);
		expect(out._interrupted).toBe(true);
	});

	it("keeps a cut-off turn's tool rows untouched", () => {
		const parts = [
			{
				input: undefined,
				state: "input-streaming" as const,
				toolCallId: "t9",
				toolName: "Bash",
				type: "dynamic-tool" as const,
			},
		];
		const out = hydrateHistoryMessage(
			{
				id: "m4",
				role: "assistant",
				content: "",
				interrupted: true,
				parts,
				timestamp: JUST_NOW,
			},
			NOW
		);
		expect(out.parts).toEqual(parts);
		expect(out._interrupted).toBe(true);
	});

	it("keeps no parts at all when the turn saved nothing", () => {
		const out = hydrateHistoryMessage(
			{
				id: "m5",
				role: "assistant",
				content: "   ",
				interrupted: true,
				timestamp: JUST_NOW,
			},
			NOW
		);
		// An empty bubble above the marker reads as a rendering bug, so the marker
		// is all there is to draw.
		expect(out.parts).toEqual([]);
		expect(out._interrupted).toBe(true);
	});

	it("marks a legacy blank-and-old assistant row with no server flag", () => {
		const out = hydrateHistoryMessage(
			{ id: "m6", role: "assistant", content: "", timestamp: LONG_AGO },
			NOW
		);
		expect(out.parts).toEqual([]);
		expect(out._interrupted).toBe(true);
	});

	it("leaves a blank assistant row that was written moments ago alone", () => {
		// A turn that has only just started is not interrupted — it is running.
		const out = hydrateHistoryMessage(
			{ id: "m7", role: "assistant", content: "", timestamp: JUST_NOW },
			NOW
		);
		expect(out._interrupted).toBeUndefined();
		expect(textOf(out.parts)).toEqual([""]);
	});

	it("never marks a user turn", () => {
		const out = hydrateHistoryMessage(
			{ id: "m8", role: "user", content: "", timestamp: LONG_AGO },
			NOW
		);
		expect(out._interrupted).toBeUndefined();
	});

	it("is stable across repeated hydrations of the same row", () => {
		const row = {
			id: "m9",
			role: "assistant" as const,
			content: "half a se",
			interrupted: true,
			timestamp: JUST_NOW,
		};
		// Reopening a tab re-runs the mapper; the surviving text must not be
		// swallowed, and nothing may accumulate across passes — the bug that made
		// the old appended note stack up.
		const first = hydrateHistoryMessage(row, NOW);
		const second = hydrateHistoryMessage(row, NOW + 5000);
		expect(second.parts).toEqual(first.parts);
		expect(textOf(second.parts)).toEqual(["half a se"]);
	});
});
