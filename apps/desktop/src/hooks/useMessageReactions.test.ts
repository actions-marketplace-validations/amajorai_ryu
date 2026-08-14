import { describe, expect, test } from "bun:test";
import type { ReactionBucket } from "@/src/lib/api/reactions.ts";
import { applyReactionDelta } from "./useMessageReactions.ts";

const bucket = (
	emoji: string,
	count: number,
	reactedByMe = false
): ReactionBucket => ({ messageId: "m1", emoji, count, reactedByMe });

describe("applyReactionDelta", () => {
	test("appends a brand-new emoji rather than sorting it in", () => {
		// Core orders by FIRST-reaction time, so a new emoji belongs at the end.
		// Sorting would reshuffle the chip row under the reader's cursor.
		const next = applyReactionDelta([bucket("👍", 2)], "m1", "🎉", "add", true);
		expect(next.map((b) => b.emoji)).toEqual(["👍", "🎉"]);
		expect(next[1]).toEqual({
			messageId: "m1",
			emoji: "🎉",
			count: 1,
			reactedByMe: true,
		});
	});

	test("joining an existing bucket bumps the count and lights it up", () => {
		const next = applyReactionDelta([bucket("👍", 2)], "m1", "👍", "add", true);
		expect(next[0].count).toBe(3);
		expect(next[0].reactedByMe).toBe(true);
	});

	test("a remote join bumps the count without claiming it as mine", () => {
		const next = applyReactionDelta(
			[bucket("👍", 2, true)],
			"m1",
			"👍",
			"add",
			false
		);
		expect(next[0].count).toBe(3);
		expect(next[0].reactedByMe).toBe(true);

		const fresh = applyReactionDelta(
			[bucket("👍", 2, false)],
			"m1",
			"👍",
			"add",
			false
		);
		expect(fresh[0].reactedByMe).toBe(false);
	});

	test("leaving a shared bucket decrements and clears only my own flag", () => {
		const next = applyReactionDelta(
			[bucket("👍", 3, true)],
			"m1",
			"👍",
			"remove",
			true
		);
		expect(next[0].count).toBe(2);
		expect(next[0].reactedByMe).toBe(false);
	});

	test("the last person out drops the chip entirely", () => {
		// A zero-count chip would render as a ghost nobody can clear.
		const next = applyReactionDelta(
			[bucket("👍", 1, true)],
			"m1",
			"👍",
			"remove",
			true
		);
		expect(next).toEqual([]);
	});

	test("a duplicate add from me is idempotent", () => {
		// Double click, or a frame delivered twice. Core keys the set on
		// (message, user, emoji), so the count must not move.
		const before = [bucket("👍", 2, true)];
		expect(applyReactionDelta(before, "m1", "👍", "add", true)).toEqual(before);
	});

	test("a duplicate remove from me is idempotent", () => {
		const before = [bucket("👍", 2, false)];
		expect(applyReactionDelta(before, "m1", "👍", "remove", true)).toEqual(
			before
		);
	});

	test("removing an emoji nobody used is a no-op, not an empty bucket", () => {
		const before = [bucket("👍", 1)];
		expect(applyReactionDelta(before, "m1", "🎉", "remove", true)).toEqual(
			before
		);
	});

	test("only the addressed message is touched", () => {
		const before: ReactionBucket[] = [
			{ messageId: "m1", emoji: "👍", count: 1, reactedByMe: false },
			{ messageId: "m2", emoji: "👍", count: 1, reactedByMe: false },
		];
		const next = applyReactionDelta(before, "m2", "👍", "add", true);
		expect(next[0].count).toBe(1);
		expect(next[1].count).toBe(2);
		expect(next[1].reactedByMe).toBe(true);
	});

	test("never mutates the input array", () => {
		const before = [bucket("👍", 1)];
		const snapshot = structuredClone(before);
		applyReactionDelta(before, "m1", "👍", "add", true);
		expect(before).toEqual(snapshot);
	});
});
