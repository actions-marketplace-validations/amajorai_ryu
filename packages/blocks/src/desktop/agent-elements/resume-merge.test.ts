import { describe, expect, it } from "bun:test";
import {
	mergeResumedReplyMessage,
	mergeResumedReplyText,
} from "./resume-merge.ts";

describe("mergeResumedReplyText", () => {
	it("keeps tool rows, thinking traces and the stats part", () => {
		const parts = [
			{ type: "tool-Thinking", toolCallId: "t-0", state: "output-available" },
			{ type: "text", text: "partial" },
			{ type: "tool-Bash", toolCallId: "b-1", state: "output-available" },
			{ type: "data-acp-usage", id: "acp-usage", data: { done: false } },
		];
		const merged = mergeResumedReplyText(parts, "partial and then some");
		expect(merged).toEqual([
			{ type: "tool-Thinking", toolCallId: "t-0", state: "output-available" },
			{ type: "text", text: "partial and then some" },
			{ type: "tool-Bash", toolCallId: "b-1", state: "output-available" },
			{ type: "data-acp-usage", id: "acp-usage", data: { done: false } },
		]);
	});

	it("collapses several text parts into one so the reply is not doubled", () => {
		const parts = [
			{ type: "text", text: "first half" },
			{ type: "tool-Read", toolCallId: "r-1" },
			{ type: "text", text: "second half" },
		];
		const merged = mergeResumedReplyText(parts, "first halfsecond half");
		expect(merged).toEqual([
			{ type: "text", text: "first halfsecond half" },
			{ type: "tool-Read", toolCallId: "r-1" },
		]);
	});

	it("collapses a legacy trailing interrupted note", () => {
		// The history mapper no longer appends that note — interruption is the
		// `_interrupted` flag, rendered as a marker (chat-history-hydrate.ts). But
		// a thread hydrated by an older build, or any producer that emits a second
		// trailing text part, must still resolve to ONE text part rather than
		// showing the reply twice. That is what this collapse guarantees.
		const parts = [
			{ type: "text", text: "half a reply" },
			{ type: "text", text: "\n\n⚠️ Interrupted" },
		];
		expect(mergeResumedReplyText(parts, "half a reply and the rest")).toEqual([
			{ type: "text", text: "half a reply and the rest" },
		]);
	});

	it("appends the text when the message has none yet", () => {
		const parts = [{ type: "tool-Bash", toolCallId: "b-1" }];
		expect(mergeResumedReplyText(parts, "hello")).toEqual([
			{ type: "tool-Bash", toolCallId: "b-1" },
			{ type: "text", text: "hello" },
		]);
	});

	it("handles a message with no parts at all", () => {
		expect(mergeResumedReplyText(undefined, "hello")).toEqual([
			{ type: "text", text: "hello" },
		]);
		expect(mergeResumedReplyText([], "hello")).toEqual([
			{ type: "text", text: "hello" },
		]);
	});
});

describe("mergeResumedReplyMessage", () => {
	it("clears the interrupted flag a delta has just disproved", () => {
		// The turn was hydrated as cut off, so the transcript is drawing an
		// "Interrupted — this reply was cut off" marker under it. A text delta says
		// otherwise. Leaving the flag on parks that crash notice underneath text
		// that is visibly still streaming — and it no longer clears itself, because
		// the notice used to be an appended text part the collapse above removed by
		// accident.
		const merged = mergeResumedReplyMessage(
			{
				id: "m1",
				role: "assistant",
				_interrupted: true,
				parts: [{ type: "text", text: "half a" }],
			},
			"half a reply"
		);
		expect(merged._interrupted).toBe(false);
		expect(merged.parts).toEqual([{ type: "text", text: "half a reply" }]);
		// Everything else about the message survives — this is a merge, not a
		// rebuild.
		expect(merged.id).toBe("m1");
		expect(merged.role).toBe("assistant");
	});

	it("leaves an uninterrupted message's own fields alone", () => {
		const merged = mergeResumedReplyMessage(
			{
				id: "m2",
				parts: [{ type: "tool-Bash", toolCallId: "b-1" }],
			},
			"hello"
		);
		expect(merged.parts).toEqual([
			{ type: "tool-Bash", toolCallId: "b-1" },
			{ type: "text", text: "hello" },
		]);
	});
});
