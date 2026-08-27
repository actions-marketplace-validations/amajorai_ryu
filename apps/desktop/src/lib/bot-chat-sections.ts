import type { Conversation } from "@/types/chat.ts";

export const UNORGANIZED_SECTION_ID = "unorganized";

export interface BotChatSection {
	id: string;
	name: string;
}

export interface BotChatSectionState {
	assignments: Record<string, string>;
	sections: BotChatSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function trimmedString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function normalizeBotChatSections(raw: unknown): BotChatSectionState {
	if (!isRecord(raw)) {
		return { assignments: {}, sections: [] };
	}

	const sections: BotChatSection[] = [];
	const sectionIds = new Set<string>();
	if (Array.isArray(raw.sections)) {
		for (const candidate of raw.sections) {
			if (!isRecord(candidate)) {
				continue;
			}
			const id = trimmedString(candidate.id);
			const name = trimmedString(candidate.name);
			if (
				!(id && name) ||
				id === UNORGANIZED_SECTION_ID ||
				sectionIds.has(id)
			) {
				continue;
			}
			sectionIds.add(id);
			sections.push({ id, name });
		}
	}

	const assignments: Record<string, string> = {};
	if (isRecord(raw.assignments)) {
		for (const [conversationId, sectionIdValue] of Object.entries(
			raw.assignments
		)) {
			const sectionId = trimmedString(sectionIdValue);
			if (conversationId.trim() && sectionId && sectionIds.has(sectionId)) {
				assignments[conversationId] = sectionId;
			}
		}
	}

	return { assignments, sections };
}

export function createBotChatSection(
	state: BotChatSectionState,
	section: BotChatSection
): BotChatSectionState {
	const id = trimmedString(section.id);
	const name = trimmedString(section.name);
	if (
		!(id && name) ||
		id === UNORGANIZED_SECTION_ID ||
		state.sections.some((item) => item.id === id)
	) {
		return state;
	}
	return { ...state, sections: [...state.sections, { id, name }] };
}

export function renameBotChatSection(
	state: BotChatSectionState,
	id: string,
	name: string
): BotChatSectionState {
	const trimmedName = name.trim();
	if (!trimmedName || id === UNORGANIZED_SECTION_ID) {
		return state;
	}
	if (!state.sections.some((section) => section.id === id)) {
		return state;
	}
	return {
		...state,
		sections: state.sections.map((section) =>
			section.id === id ? { ...section, name: trimmedName } : section
		),
	};
}

export function removeBotChatSection(
	state: BotChatSectionState,
	id: string
): BotChatSectionState {
	if (id === UNORGANIZED_SECTION_ID) {
		return state;
	}
	const sections = state.sections.filter((section) => section.id !== id);
	if (sections.length === state.sections.length) {
		return state;
	}
	const assignments = Object.fromEntries(
		Object.entries(state.assignments).filter(
			([, sectionId]) => sectionId !== id
		)
	);
	return { assignments, sections };
}

export function assignConversationToBotChatSection(
	state: BotChatSectionState,
	conversationId: string,
	sectionId: string
): BotChatSectionState {
	if (!conversationId.trim()) {
		return state;
	}
	if (
		sectionForConversation(state, conversationId) === sectionId &&
		(sectionId === UNORGANIZED_SECTION_ID ||
			state.assignments[conversationId] === sectionId)
	) {
		return state;
	}
	const assignments = { ...state.assignments };
	if (
		sectionId === UNORGANIZED_SECTION_ID ||
		!state.sections.some((section) => section.id === sectionId)
	) {
		delete assignments[conversationId];
	} else {
		assignments[conversationId] = sectionId;
	}
	return { ...state, assignments };
}

export function sectionForConversation(
	state: BotChatSectionState,
	conversationId: string
): string {
	const sectionId = state.assignments[conversationId];
	return state.sections.some((section) => section.id === sectionId)
		? (sectionId as string)
		: UNORGANIZED_SECTION_ID;
}

export function sortConversationsByActivity(
	conversations: readonly Conversation[]
): Conversation[] {
	return [...conversations].sort((a, b) => {
		const activityDelta =
			(b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt);
		if (activityDelta !== 0) {
			return activityDelta;
		}
		const updatedDelta = b.updatedAt - a.updatedAt;
		if (updatedDelta !== 0) {
			return updatedDelta;
		}
		return a.title.localeCompare(b.title);
	});
}

export function conversationsForSection(
	conversations: readonly Conversation[],
	state: BotChatSectionState,
	sectionId: string
): Conversation[] {
	return sortConversationsByActivity(
		conversations.filter(
			(conversation) =>
				sectionForConversation(state, conversation.id) === sectionId
		)
	);
}
