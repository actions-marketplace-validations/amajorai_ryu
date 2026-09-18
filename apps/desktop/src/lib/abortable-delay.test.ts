import { expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { abortableDelay } from "./abortable-delay.ts";

test("completed retry delays release their listeners and cancellation clears pending waits", async () => {
	const controller = new AbortController();
	for (let index = 0; index < 12; index++) {
		await abortableDelay(1, controller.signal);
		expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	}
	const pending = abortableDelay(60_000, controller.signal);
	expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
	controller.abort();
	await pending;
	expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
	await abortableDelay(60_000, controller.signal);
	expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});
