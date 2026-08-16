import { describe, expect, it } from "bun:test";
import { conversationRunStatusMeta } from "./conversation-run-status.ts";

describe("conversationRunStatusMeta", () => {
	it("keeps a startup interruption distinct from a failure", () => {
		expect(conversationRunStatusMeta("interrupted")).toMatchObject({
			label: "Interrupted",
			needsAttention: true,
			isRunning: false,
		});
		expect(conversationRunStatusMeta("interrupted")?.description).toContain(
			"continue it manually"
		);
	});

	it("makes an input wait explicit and non-resumable", () => {
		expect(conversationRunStatusMeta("awaiting_input")).toMatchObject({
			label: "Needs input",
			needsAttention: true,
			isRunning: false,
		});
	});
});
