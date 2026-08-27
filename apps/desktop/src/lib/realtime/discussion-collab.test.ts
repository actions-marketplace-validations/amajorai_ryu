import { describe, expect, test } from "bun:test";
import type { TDiscussion } from "@ryu/ui/components/editor/plugins/discussion-kit";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { DiscussionCollabStore } from "./discussion-collab.ts";

function synchronize(source: Doc, target: Doc): void {
	applyUpdate(target, encodeStateAsUpdate(source));
}

function discussion(): TDiscussion {
	return {
		comments: [
			{
				contentRich: [{ children: [{ text: "First" }], type: "p" }],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				discussionId: "discussion-1",
				id: "comment-1",
				isEdited: false,
				userId: "user-a",
			},
		],
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		documentContent: "selected text",
		id: "discussion-1",
		isResolved: false,
		userId: "user-a",
	};
}

describe("DiscussionCollabStore", () => {
	test("merges concurrent replies as independent CRDT entries", () => {
		const leftDocument = new Doc();
		const left = new DiscussionCollabStore(leftDocument);
		left.writeDiscussions([discussion()]);

		const rightDocument = new Doc();
		synchronize(leftDocument, rightDocument);
		const right = new DiscussionCollabStore(rightDocument);

		const leftDiscussion = left.readDiscussions()[0];
		const rightDiscussion = right.readDiscussions()[0];
		expect(leftDiscussion).toBeDefined();
		expect(rightDiscussion).toBeDefined();
		if (!(leftDiscussion && rightDiscussion)) {
			throw new Error("seed discussion missing");
		}

		left.writeDiscussions([
			{
				...leftDiscussion,
				comments: [
					...leftDiscussion.comments,
					{
						contentRich: [{ children: [{ text: "Left" }], type: "p" }],
						createdAt: new Date("2026-01-01T00:01:00.000Z"),
						discussionId: leftDiscussion.id,
						id: "comment-left",
						isEdited: false,
						userId: "user-a",
					},
				],
			},
		]);
		right.writeDiscussions([
			{
				...rightDiscussion,
				comments: [
					...rightDiscussion.comments,
					{
						contentRich: [{ children: [{ text: "Right" }], type: "p" }],
						createdAt: new Date("2026-01-01T00:02:00.000Z"),
						discussionId: rightDiscussion.id,
						id: "comment-right",
						isEdited: false,
						userId: "user-b",
					},
				],
			},
		]);

		synchronize(leftDocument, rightDocument);
		synchronize(rightDocument, leftDocument);

		expect(
			left.readDiscussions()[0]?.comments.map((comment) => comment.id)
		).toEqual(["comment-1", "comment-left", "comment-right"]);
		expect(right.readDiscussions()).toEqual(left.readDiscussions());
	});

	test("shares authenticated user metadata", () => {
		const sourceDocument = new Doc();
		const source = new DiscussionCollabStore(sourceDocument);
		source.writeUser({
			avatarUrl: "https://example.test/avatar.png",
			id: "person@example.test",
			name: "Person",
		});

		const targetDocument = new Doc();
		synchronize(sourceDocument, targetDocument);

		expect(new DiscussionCollabStore(targetDocument).readUsers()).toEqual({
			"person@example.test": {
				avatarUrl: "https://example.test/avatar.png",
				id: "person@example.test",
				name: "Person",
			},
		});
	});
});
