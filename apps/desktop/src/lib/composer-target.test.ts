import { describe, expect, it } from "bun:test";
import {
	conversationTargetDecision,
	seedComposerAgentId,
	shouldAdoptNodeDefault,
} from "./composer-target.ts";

describe("seedComposerAgentId", () => {
	it("pins the merged view's agent above every other source", () => {
		expect(
			seedComposerAgentId({
				pinnedAgentId: "claude",
				seededAgentId: "opencode",
				lastUsedAgentId: "ryu",
			})
		).toBe("claude");
	});

	it("prefers the tab seed over the last-used hint", () => {
		expect(
			seedComposerAgentId({ seededAgentId: "opencode", lastUsedAgentId: "ryu" })
		).toBe("opencode");
	});

	it("falls back to the last agent the user picked", () => {
		expect(seedComposerAgentId({ lastUsedAgentId: "ryu" })).toBe("ryu");
	});

	it("returns null when nothing synchronous applies, so the node default can", () => {
		expect(seedComposerAgentId({})).toBeNull();
		expect(seedComposerAgentId({ lastUsedAgentId: null })).toBeNull();
	});
});

describe("shouldAdoptNodeDefault", () => {
	it("fills a hole", () => {
		expect(shouldAdoptNodeDefault(null, "ryu")).toBe(true);
	});

	it("never retargets a composer that already has an agent", () => {
		expect(shouldAdoptNodeDefault("opencode", "ryu")).toBe(false);
	});

	it("does nothing when the node declares no default", () => {
		expect(shouldAdoptNodeDefault(null, null)).toBe(false);
		expect(shouldAdoptNodeDefault(null, undefined)).toBe(false);
	});
});

describe("conversationTargetDecision", () => {
	it("adopts the conversation's pinned agent the first time", () => {
		expect(
			conversationTargetDecision({
				conversationId: "conv-a",
				hydratedConversationId: null,
				conversationAgentId: "opencode",
			})
		).toEqual({ hydrate: true, agentId: "opencode" });
	});

	it("does not re-adopt the same conversation, so an in-thread pick sticks", () => {
		expect(
			conversationTargetDecision({
				conversationId: "conv-a",
				hydratedConversationId: "conv-a",
				conversationAgentId: "opencode",
			})
		).toEqual({ hydrate: false, agentId: null });
	});

	it("adopts again when the tab moves to a different conversation", () => {
		expect(
			conversationTargetDecision({
				conversationId: "conv-b",
				hydratedConversationId: "conv-a",
				conversationAgentId: "claude",
			})
		).toEqual({ hydrate: true, agentId: "claude" });
	});

	it("waits while the conversation list is still loading", () => {
		// `getConversation` returns undefined until Core's list lands; hydrating on
		// that would latch the conversation as done and never pick up its agent.
		expect(
			conversationTargetDecision({
				conversationId: "conv-a",
				hydratedConversationId: null,
				conversationAgentId: undefined,
			})
		).toEqual({ hydrate: false, agentId: null });
	});

	it("leaves an unpinned conversation on the composer's own agent", () => {
		expect(
			conversationTargetDecision({
				conversationId: "conv-a",
				hydratedConversationId: null,
				conversationAgentId: null,
			})
		).toEqual({ hydrate: false, agentId: null });
	});

	it("does nothing for a chat that has no conversation yet", () => {
		expect(
			conversationTargetDecision({
				conversationId: null,
				hydratedConversationId: null,
				conversationAgentId: "ryu",
			})
		).toEqual({ hydrate: false, agentId: null });
	});
});
