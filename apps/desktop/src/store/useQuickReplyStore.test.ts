import { describe, expect, it } from "bun:test";
import { useQuickReplyStore } from "./useQuickReplyStore.ts";

const TARGET_URL = "http://127.0.0.1:8980";

describe("quick reply bridge", () => {
	it("dispatches directly to an open conversation handler", () => {
		const received: string[] = [];
		const unregister = useQuickReplyStore
			.getState()
			.registerHandler(TARGET_URL, "conv-open", (content) => {
				received.push(content);
			});

		expect(
			useQuickReplyStore
				.getState()
				.submit(TARGET_URL, "conv-open", "Follow up here")
		).toBe("sent");
		expect(received).toEqual(["Follow up here"]);
		unregister();
	});

	it("holds a submission until a newly opened chat registers", () => {
		useQuickReplyStore.setState({ pending: [], request: null });
		const received: string[] = [];

		expect(
			useQuickReplyStore
				.getState()
				.submit(TARGET_URL, "conv-pending", "Queued from the sidebar")
		).toBe("queued");

		const unregister = useQuickReplyStore
			.getState()
			.registerHandler(TARGET_URL, "conv-pending", (content) => {
				received.push(content);
			});
		expect(received).toEqual(["Queued from the sidebar"]);
		expect(useQuickReplyStore.getState().pending).toEqual([]);
		unregister();
	});
});
