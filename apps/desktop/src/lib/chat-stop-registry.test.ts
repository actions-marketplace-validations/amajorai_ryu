import { afterEach, describe, expect, test } from "bun:test";
import { registerChatStop, stopConversation } from "./chat-stop-registry.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

describe("chat stop registry", () => {
	test("stops every active local owner for the archived conversation", () => {
		const stopped: string[] = [];
		cleanups.push(
			registerChatStop("chat-1", () => stopped.push("first")),
			registerChatStop("chat-1", () => stopped.push("second")),
			registerChatStop("chat-2", () => stopped.push("other"))
		);

		expect(stopConversation("chat-1")).toBe(true);
		expect(stopped).toEqual(["first", "second"]);
	});

	test("returns false after the conversation has no active local owner", () => {
		const cleanup = registerChatStop("chat-1", () => undefined);
		cleanup();

		expect(stopConversation("chat-1")).toBe(false);
	});
});
