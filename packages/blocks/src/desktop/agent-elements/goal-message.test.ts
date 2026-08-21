import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { isGoalMessage } from "./goal-message.ts";

function message(metadata?: unknown): UIMessage {
	return {
		id: "message",
		metadata,
		parts: [{ text: "Finish the task", type: "text" }],
		role: "user",
	} as UIMessage;
}

describe("goal message metadata", () => {
	it("recognizes goal-setting messages", () => {
		expect(isGoalMessage(message({ goal: true }))).toBe(true);
	});

	it("ignores ordinary and malformed metadata", () => {
		expect(isGoalMessage(message())).toBe(false);
		expect(isGoalMessage(message({ goal: false }))).toBe(false);
		expect(isGoalMessage(message({ goal: "true" }))).toBe(false);
		expect(isGoalMessage(message("goal"))).toBe(false);
	});
});
