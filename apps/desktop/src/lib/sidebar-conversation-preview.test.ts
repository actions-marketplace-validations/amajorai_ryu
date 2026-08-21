import { describe, expect, it } from "bun:test";
import { buildSidebarConversationPreviewStates } from "@/src/lib/sidebar-conversation-preview.ts";

describe("buildSidebarConversationPreviewStates", () => {
	it("labels the user's latest message and appends active run state", () => {
		expect(
			buildSidebarConversationPreviewStates({
				lastMessage: "  Check the release notes  ",
				lastMessageRole: "user",
				statusLabel: "In progress",
				statusVisible: true,
			})
		).toEqual(["You: Check the release notes", "In progress"]);
	});

	it("keeps assistant messages unprefixed", () => {
		expect(
			buildSidebarConversationPreviewStates({
				lastMessage: "The files are ready.",
				lastMessageRole: "assistant",
			})
		).toEqual(["The files are ready."]);
	});

	it("uses a stable empty state when there is no message or active run", () => {
		expect(buildSidebarConversationPreviewStates({})).toEqual([
			"No messages yet",
		]);
	});
});
