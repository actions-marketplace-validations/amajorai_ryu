import { expect, test } from "bun:test";
import {
	dequeueChatMessage,
	enqueueChatMessage,
	MAX_QUEUED_CHAT_MESSAGES,
} from "../core/chatQueue.ts";

test("queues trimmed prompts in FIFO order", () => {
	const first = enqueueChatMessage([], "  first  ");
	const second = enqueueChatMessage(first.queue, "second");

	expect(first.accepted).toBe(true);
	expect(second.queue).toEqual(["first", "second"]);
	expect(dequeueChatMessage(second.queue)).toEqual({
		message: "first",
		queue: ["second"],
	});
});

test("rejects blank prompts and preserves the existing queue", () => {
	const result = enqueueChatMessage(["waiting"], "   ");

	expect(result.accepted).toBe(false);
	expect(result.queue).toEqual(["waiting"]);
});

test("rejects prompts after the bounded queue is full", () => {
	const full = Array.from(
		{ length: MAX_QUEUED_CHAT_MESSAGES },
		(_, index) => `prompt-${index}`
	);
	const result = enqueueChatMessage(full, "overflow");

	expect(result.accepted).toBe(false);
	expect(result.queue).toEqual(full);
});

test("dequeueing an empty queue is a no-op", () => {
	expect(dequeueChatMessage([])).toEqual({ message: null, queue: [] });
});
