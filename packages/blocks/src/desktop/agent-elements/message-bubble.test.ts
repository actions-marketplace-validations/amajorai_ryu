import { describe, expect, test } from "bun:test";
import {
	messageBubbleRadius,
	messageGroupPositionFor,
} from "./message-bubble.ts";

describe("messageBubbleRadius", () => {
	test("flattens the touching left corners for an incoming run", () => {
		expect(messageBubbleRadius("start", "first")).toBe(
			"rounded-2xl rounded-bl-md"
		);
		expect(messageBubbleRadius("start", "middle")).toBe(
			"rounded-2xl rounded-l-md"
		);
		expect(messageBubbleRadius("start", "last")).toBe(
			"rounded-2xl rounded-tl-md"
		);
	});

	test("mirrors the contact corners for an outgoing run", () => {
		expect(messageBubbleRadius("end", "first")).toBe(
			"rounded-2xl rounded-br-md"
		);
		expect(messageBubbleRadius("end", "middle")).toBe(
			"rounded-2xl rounded-r-md"
		);
		expect(messageBubbleRadius("end", "last")).toBe(
			"rounded-2xl rounded-tr-md"
		);
	});
});

describe("messageGroupPositionFor", () => {
	test("returns the four sender-run positions", () => {
		expect([0, 1, 2].map((index) => messageGroupPositionFor(index, 3))).toEqual(
			["first", "middle", "last"]
		);
		expect(messageGroupPositionFor(0, 1)).toBe("single");
	});
});
