import { expect, test } from "bun:test";
import type { Conversation } from "@/types/chat.ts";
import {
	assignConversationToBotChatSection,
	conversationsForSection,
	createBotChatSection,
	normalizeBotChatSections,
	removeBotChatSection,
	renameBotChatSection,
	sectionForConversation,
	sortConversationsByActivity,
	UNORGANIZED_SECTION_ID,
} from "./bot-chat-sections.ts";

const conversation = (
	id: string,
	updatedAt: number,
	lastMessageAt?: number
): Conversation => ({
	createdAt: updatedAt,
	id,
	lastMessageAt,
	messages: [],
	title: id,
	updatedAt,
});

test("normalization fails soft to Unorganized", () => {
	const state = normalizeBotChatSections({
		assignments: { stale: "missing", loose: "section-a" },
		sections: [
			{ id: "section-a", name: "  Follow up  " },
			{ id: UNORGANIZED_SECTION_ID, name: "Renamed" },
			{ id: "section-a", name: "Duplicate" },
		],
	});

	expect(state.sections).toEqual([{ id: "section-a", name: "Follow up" }]);
	expect(sectionForConversation(state, "stale")).toBe(UNORGANIZED_SECTION_ID);
	expect(sectionForConversation(state, "loose")).toBe("section-a");
});

test("sorts every section by latest message activity", () => {
	const sorted = sortConversationsByActivity([
		conversation("fallback", 40),
		conversation("latest-message", 20, 90),
		conversation("older-message", 80, 60),
	]);

	expect(sorted.map((item) => item.id)).toEqual([
		"latest-message",
		"older-message",
		"fallback",
	]);
});

test("filters conversations into a custom section and keeps unknown ids loose", () => {
	const state = normalizeBotChatSections({
		assignments: { one: "section-a", stale: "gone" },
		sections: [{ id: "section-a", name: "Follow up" }],
	});
	const conversations = [conversation("one", 1), conversation("two", 2)];

	expect(
		conversationsForSection(conversations, state, "section-a").map(
			(item) => item.id
		)
	).toEqual(["one"]);
	expect(
		conversationsForSection(conversations, state, UNORGANIZED_SECTION_ID).map(
			(item) => item.id
		)
	).toEqual(["two"]);
});

test("section transitions keep local assignments coherent", () => {
	const created = createBotChatSection(normalizeBotChatSections(null), {
		id: "section-a",
		name: "Follow up",
	});
	const renamed = renameBotChatSection(
		created,
		"section-a",
		" Client follow-up "
	);
	const assigned = assignConversationToBotChatSection(
		renamed,
		"one",
		"section-a"
	);

	expect(renamed.sections).toEqual([
		{ id: "section-a", name: "Client follow-up" },
	]);
	expect(assigned.assignments).toEqual({ one: "section-a" });

	const removed = removeBotChatSection(assigned, "section-a");
	expect(removed.sections).toEqual([]);
	expect(removed.assignments).toEqual({});
	expect(sectionForConversation(removed, "one")).toBe(UNORGANIZED_SECTION_ID);
});
