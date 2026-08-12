// apps/desktop/src/hooks/useMergedAgentThreads.test.ts
//
// The merged agent view renders messages from OTHER conversations inside the
// live thread's transcript. Every per-message action in ChatPage (edit, branch,
// regenerate, select-version, feedback) targets the live conversation, so the
// only thing standing between a click on foreign history and a write into the
// wrong thread is the id tagging tested here. That is the whole reason these
// helpers are pure and exported.

import { describe, expect, test } from "bun:test";
import {
	isMergedHistoryId,
	mergedHistorySource,
} from "./useMergedAgentThreads.ts";

describe("merged history ids", () => {
	test("a live-thread id is never mistaken for prepended history", () => {
		expect(isMergedHistoryId("msg-123")).toBe(false);
		expect(isMergedHistoryId("018f2c1e-0000-7000-8000-000000000000")).toBe(
			false
		);
		expect(mergedHistorySource("msg-123")).toBeNull();
	});

	test("a prepended id is recognised and names its source conversation", () => {
		const id = "merged:conv-abc:msg-7";
		expect(isMergedHistoryId(id)).toBe(true);
		expect(mergedHistorySource(id)).toBe("conv-abc");
	});

	test("a message id containing colons still resolves the conversation", () => {
		// Ids are concatenated as `merged:<conv>:<message>`; a message id with its
		// own colons must not shift which segment is read as the conversation.
		expect(mergedHistorySource("merged:conv-abc:acp:session:9")).toBe(
			"conv-abc"
		);
	});
});
