import { describe, expect, test } from "bun:test";
import { ApplicationRealtimeQueue } from "./application-realtime-queue.ts";

const signal = () => new AbortController().signal;

describe("ApplicationRealtimeQueue", () => {
	test("keeps named events ordered", async () => {
		const queue = new ApplicationRealtimeQueue();
		queue.push({ data: 1, name: "first", type: "event" });
		queue.push({ data: 2, name: "second", type: "event" });

		expect(await queue.take(signal())).toEqual({
			data: 1,
			name: "first",
			type: "event",
		});
		expect(await queue.take(signal())).toEqual({
			data: 2,
			name: "second",
			type: "event",
		});
	});

	test("coalesces queued presence snapshots", async () => {
		const queue = new ApplicationRealtimeQueue();
		queue.push({ data: { online: 1 }, type: "presence" });
		queue.push({ data: "message", name: "changed", type: "event" });
		queue.push({ data: { online: 2 }, type: "presence" });

		expect(await queue.take(signal())).toEqual({
			data: "message",
			name: "changed",
			type: "event",
		});
		expect(await queue.take(signal())).toEqual({
			data: { online: 2 },
			type: "presence",
		});
	});

	test("closes with an observable overload signal instead of growing", async () => {
		const queue = new ApplicationRealtimeQueue(2);
		expect(queue.push({ data: 1, name: "one", type: "event" })).toBe(true);
		expect(queue.push({ data: 2, name: "two", type: "event" })).toBe(true);
		expect(queue.push({ data: 3, name: "three", type: "event" })).toBe(false);

		expect(await queue.take(signal())).toEqual({
			code: 1013,
			reason: "realtime consumer fell behind",
			type: "close",
		});
		expect(await queue.take(signal())).toBeNull();
	});

	test("preserves a server close when the queue is full", async () => {
		const queue = new ApplicationRealtimeQueue(2);
		queue.push({ data: 1, name: "one", type: "event" });
		queue.push({ data: 2, name: "two", type: "event" });
		queue.close({ code: 1000, reason: "done", type: "close" });

		expect(await queue.take(signal())).toEqual({
			data: 1,
			name: "one",
			type: "event",
		});
		expect(await queue.take(signal())).toEqual({
			code: 1000,
			reason: "done",
			type: "close",
		});
	});

	test("removes an aborted waiter", async () => {
		const queue = new ApplicationRealtimeQueue();
		const controller = new AbortController();
		const pending = queue.take(controller.signal);
		controller.abort();
		expect(await pending).toBeNull();

		queue.push({ data: 1, name: "after-abort", type: "event" });
		expect(await queue.take(signal())).toEqual({
			data: 1,
			name: "after-abort",
			type: "event",
		});
	});
});
