import { useCallback, useState } from "react";
import {
	assignConversationToBotChatSection,
	type BotChatSectionState,
	createBotChatSection,
	normalizeBotChatSections,
	removeBotChatSection,
	renameBotChatSection,
} from "@/src/lib/bot-chat-sections.ts";

const BOT_CHAT_SECTIONS_STORAGE_KEY = "ryu:bot-chat-sections:v1";
export const BOT_CHAT_SECTION_ORDER_KEY = "ryu:bot-chat-section-order:v1";
export const BOT_CHAT_SECTION_COLLAPSED_KEY =
	"ryu:bot-chat-section-collapsed:v1";

function readState(): BotChatSectionState {
	try {
		const stored = localStorage.getItem(BOT_CHAT_SECTIONS_STORAGE_KEY);
		return stored
			? normalizeBotChatSections(JSON.parse(stored))
			: normalizeBotChatSections(null);
	} catch {
		return normalizeBotChatSections(null);
	}
}

function writeState(state: BotChatSectionState) {
	try {
		localStorage.setItem(BOT_CHAT_SECTIONS_STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Best-effort persistence. The in-memory state remains usable.
	}
}

function newSectionId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `section-${crypto.randomUUID()}`;
	}
	return `section-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useBotChatSections() {
	const [state, setState] = useState<BotChatSectionState>(readState);

	const commit = useCallback(
		(next: BotChatSectionState) => {
			if (next === state) {
				return;
			}
			setState(next);
			writeState(next);
		},
		[state]
	);

	const createSection = useCallback(
		(name: string) => {
			const id = newSectionId();
			const next = createBotChatSection(state, { id, name });
			if (next === state) {
				return null;
			}
			commit(next);
			return id;
		},
		[commit, state]
	);

	const renameSection = useCallback(
		(id: string, name: string) => {
			commit(renameBotChatSection(state, id, name));
		},
		[commit, state]
	);

	const deleteSection = useCallback(
		(id: string) => {
			commit(removeBotChatSection(state, id));
		},
		[commit, state]
	);

	const assignConversation = useCallback(
		(conversationId: string, sectionId: string) => {
			commit(
				assignConversationToBotChatSection(state, conversationId, sectionId)
			);
		},
		[commit, state]
	);

	return {
		assignments: state.assignments,
		assignConversation,
		createSection,
		deleteSection,
		renameSection,
		sections: state.sections,
	};
}
