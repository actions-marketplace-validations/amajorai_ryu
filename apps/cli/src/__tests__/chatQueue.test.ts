import { expect, test } from "bun:test";
import {
	chatQueueReducer,
	clearChatQueue,
	createQueuedChatTurn,
	dequeueChatMessage,
	dequeueChatTurn,
	enqueueChatMessage,
	enqueueChatTurn,
	MAX_QUEUED_CHAT_MESSAGES,
	moveQueuedChatTurn,
	removeQueuedChatTurn,
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

test("creates typed turns with stable ids and timestamps", () => {
	const turn = createQueuedChatTurn(
		"  hello  ",
		{ agentId: "agent-before" },
		{
			idFactory: (_createdAt, sequence) => `test-${sequence}`,
			now: () => 1234,
		}
	);

	expect(turn).toEqual({
		createdAt: 1234,
		id: "test-1",
		options: { agentId: "agent-before" },
		text: "hello",
	});
});

test("snapshots routing options when a typed turn is enqueued", () => {
	const options = {
		acpConfig: { effort: "low" },
		acpMode: "default",
		acpModel: "model-before",
		agentId: "agent-before",
		pluginFlags: { "io.ryu.double-check": false },
	};
	const result = enqueueChatTurn([], {
		createdAt: 100,
		id: "turn-1",
		options,
		text: "queued",
	});

	options.acpConfig.effort = "high";
	options.pluginFlags["io.ryu.double-check"] = true;
	options.agentId = "agent-after";

	expect(result.accepted).toBe(true);
	expect(result.queue[0]).toEqual({
		createdAt: 100,
		id: "turn-1",
		options: {
			acpConfig: { effort: "low" },
			acpMode: "default",
			acpModel: "model-before",
			agentId: "agent-before",
			pluginFlags: { "io.ryu.double-check": false },
		},
		text: "queued",
	});
});

test("typed turns remain FIFO and dequeue preserves their identity", () => {
	const first = enqueueChatTurn([], {
		createdAt: 1,
		id: "first",
		options: { agentId: "agent-1" },
		text: " first ",
	});
	const second = enqueueChatTurn(first.queue, {
		createdAt: 2,
		id: "second",
		options: { teamId: "team-2" },
		text: "second",
	});
	const result = dequeueChatTurn(second.queue);

	expect(result.turn).toEqual(second.queue[0]);
	expect(result.turn?.id).toBe("first");
	expect(result.queue.map((turn) => turn.id)).toEqual(["second"]);
});

test("typed queue rejects blanks and enforces the bounded capacity", () => {
	const blank = enqueueChatTurn([], "   ", { agentId: "ignored" });
	const full = Array.from({ length: MAX_QUEUED_CHAT_MESSAGES }, (_, index) => ({
		createdAt: index,
		id: `turn-${index}`,
		options: {},
		text: `prompt-${index}`,
	}));
	const overflow = enqueueChatTurn(full, "overflow", { agentId: "ignored" });

	expect(blank).toEqual({ accepted: false, queue: [] });
	expect(overflow.accepted).toBe(false);
	expect(overflow.queue).toEqual(full);
});

test("removes one typed turn by id and clears only queued turns", () => {
	const queue = [
		{ createdAt: 1, id: "first", options: {}, text: "first" },
		{ createdAt: 2, id: "second", options: {}, text: "second" },
	];

	expect(removeQueuedChatTurn(queue, "first")).toEqual([queue[1]]);
	expect(removeQueuedChatTurn(queue, "missing")).toEqual(queue);
	expect(clearChatQueue(queue)).toEqual([]);
});

test("reorders a typed turn without changing its identity or options", () => {
	const queue = [
		{ createdAt: 1, id: "first", options: { agentId: "one" }, text: "first" },
		{ createdAt: 2, id: "second", options: { teamId: "two" }, text: "second" },
		{ createdAt: 3, id: "third", options: {}, text: "third" },
	];

	const movedUp = moveQueuedChatTurn(queue, "third", "up");
	const movedDown = moveQueuedChatTurn(movedUp, "third", "down");

	expect(movedUp.map((turn) => turn.id)).toEqual(["first", "third", "second"]);
	expect(movedDown).toEqual(queue);
	expect(movedUp[1]?.options).toEqual({});
	expect(moveQueuedChatTurn(queue, "first", "up")).toEqual(queue);
});

test("reducer applies enqueue, dequeue, remove, and clear transitions", () => {
	const first = chatQueueReducer([], {
		type: "enqueue",
		input: { createdAt: 10, id: "first", options: {}, text: "first" },
	});
	const second = chatQueueReducer(first, {
		createdAt: 20,
		id: "second",
		options: { teamId: "team-2" },
		text: "second",
		type: "enqueue",
	});
	const afterDequeue = chatQueueReducer(second, { type: "dequeue" });
	const afterRemove = chatQueueReducer(afterDequeue, {
		id: "second",
		type: "remove-by-id",
	});

	expect(afterDequeue.map((turn) => turn.id)).toEqual(["second"]);
	expect(afterRemove).toEqual([]);
	expect(chatQueueReducer(second, { type: "clear" })).toEqual([]);
});
