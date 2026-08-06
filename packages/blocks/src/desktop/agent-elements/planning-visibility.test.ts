// The regression this file exists for: a conversation whose run died long ago
// reloads with a trailing user message, no assistant reply, and `status:
// "ready"`. It used to shimmer "Thinking" forever, and because the composer's
// Stop button derives from the same streaming flag, the trailing slot stayed on
// voice mode — a chat that looked busy with no way to stop it.

import { describe, expect, test } from "bun:test";
import { shouldShowPlanning } from "./planning-visibility.ts";

const base = {
	hasMessages: true,
	lastMessageIsUser: false,
	lastTurnHasAssistant: false,
	isStreaming: false,
	lastAssistantHasContent: false,
};

describe("shouldShowPlanning", () => {
	test("empty transcript shows nothing", () => {
		expect(shouldShowPlanning({ ...base, hasMessages: false })).toBe(false);
	});

	test("just-sent user message shows the planning row", () => {
		expect(
			shouldShowPlanning({
				...base,
				lastMessageIsUser: true,
				isStreaming: true,
			})
		).toBe(true);
	});

	test("dead run — trailing user message, not streaming — shows nothing", () => {
		expect(
			shouldShowPlanning({
				...base,
				lastMessageIsUser: true,
				isStreaming: false,
			})
		).toBe(false);
	});

	test("streaming assistant turn with no content yet keeps the row", () => {
		expect(
			shouldShowPlanning({
				...base,
				lastTurnHasAssistant: true,
				isStreaming: true,
				lastAssistantHasContent: false,
			})
		).toBe(true);
	});

	test("assistant content rendered — the message takes over", () => {
		expect(
			shouldShowPlanning({
				...base,
				lastTurnHasAssistant: true,
				isStreaming: true,
				lastAssistantHasContent: true,
			})
		).toBe(false);
	});

	test("settled turn shows nothing", () => {
		expect(
			shouldShowPlanning({
				...base,
				lastTurnHasAssistant: true,
				lastAssistantHasContent: true,
			})
		).toBe(false);
	});
});
