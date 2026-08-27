import { describe, expect, test } from "bun:test";
import {
	conversationEntityKey,
	type EntityActivation,
	tabEntityKey,
	type WindowTabRegistration,
} from "./window-routing.ts";

describe("window entity keys", () => {
	test("encodes conversation ids without ambiguous separators", () => {
		expect(conversationEntityKey("team/a & 你好")).toBe(
			"conversation:team%2Fa%20%26%20%E4%BD%A0%E5%A5%BD"
		);
	});

	test("uses the saved conversation binding, regardless of the local tab id", () => {
		const tab = { conversationId: "conversation-42" };
		expect(tabEntityKey(tab)).toBe("conversation:conversation-42");
	});

	test("does not claim an unbound composer tab", () => {
		expect(tabEntityKey({})).toBeNull();
	});

	test("registration entries carry exactly one active marker per window snapshot", () => {
		const entries: WindowTabRegistration[] = [
			{ active: false, key: "conversation:first" },
			{ active: true, key: "conversation:second" },
		];
		expect(entries.filter((entry) => entry.active)).toHaveLength(1);
	});

	test("activation protocol can carry an exact message target", () => {
		const activation: EntityActivation = {
			key: conversationEntityKey("conversation-42"),
			messageId: "message-99",
		};
		expect(activation).toEqual({
			key: "conversation:conversation-42",
			messageId: "message-99",
		});
	});
});
