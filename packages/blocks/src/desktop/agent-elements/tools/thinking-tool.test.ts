// The regression this file exists for: a "Thinking" row kept shimmering and
// counting up on turns that had already ended. The part's own state is not
// enough — a crashed, cancelled or Core-restarted turn never sends the closing
// frame that would move it off `input-available`, so the row stayed "animating"
// forever, and started counting from zero again on every reopen of the thread.

import { describe, expect, test } from "bun:test";
import { resolveThinkingStepState } from "./thinking-state.ts";

describe("resolveThinkingStepState", () => {
	test("keeps animating while the chat is streaming", () => {
		expect(
			resolveThinkingStepState({
				chatStatus: "streaming",
				stateFromPart: true,
				stepState: "animating",
			})
		).toBe("animating");
	});

	test("keeps animating while the turn is submitted", () => {
		expect(
			resolveThinkingStepState({
				chatStatus: "submitted",
				stateFromPart: true,
				stepState: "animating",
			})
		).toBe("animating");
	});

	test("freezes a part-derived thought when the chat is no longer running", () => {
		// Stop / error / Core restart: the closing frame never arrives, so the
		// part still reads "animating" while the chat has gone back to ready.
		expect(
			resolveThinkingStepState({
				chatStatus: "ready",
				stateFromPart: true,
				stepState: "animating",
			})
		).toBe("complete");
	});

	test("freezes an old turn read back from history", () => {
		// message-list passes `undefined` for anything that is not the live last
		// message — the same value `getToolStatus` already treats as not pending.
		expect(
			resolveThinkingStepState({
				stateFromPart: true,
				stepState: "animating",
			})
		).toBe("complete");
	});

	test("leaves a caller-driven state alone", () => {
		// A surface passing `state` explicitly is not reading the part, so there
		// is nothing to second-guess — and it may not track chatStatus at all.
		expect(
			resolveThinkingStepState({
				stateFromPart: false,
				stepState: "animating",
			})
		).toBe("animating");
	});

	test("never resurrects a finished thought", () => {
		expect(
			resolveThinkingStepState({
				chatStatus: "streaming",
				stateFromPart: true,
				stepState: "complete",
			})
		).toBe("complete");
	});
});
