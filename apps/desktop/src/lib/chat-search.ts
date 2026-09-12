/** The message fields needed by the chat-local find surface. */
export interface ChatSearchableMessage {
	content?: unknown;
	id: string;
	parts?: readonly unknown[];
	role?: string;
}

/** One message matched by the chat-local find surface. */
export interface ChatSearchMatch {
	/** The turn anchor that the transcript can scroll to. */
	anchorMessageId: string;
	content: string;
	messageId: string;
	role: string;
}

function textFromPart(part: unknown): string {
	if (typeof part !== "object" || part === null) {
		return "";
	}
	const candidate = part as { text?: unknown; type?: unknown };
	return candidate.type === "text" && typeof candidate.text === "string"
		? candidate.text
		: "";
}

/** Read the same visible text parts that the transcript renders. */
export function chatMessageText(message: ChatSearchableMessage): string {
	if (Array.isArray(message.parts) && message.parts.length > 0) {
		return message.parts.map(textFromPart).join("\n\n");
	}
	return typeof message.content === "string" ? message.content : "";
}

/** A snapshot of visible text; rebuild when the loaded messages change. */
export interface ChatSearchIndexEntry extends ChatSearchMatch {
	normalizedContent: string;
}

export function buildChatSearchIndex(
	messages: readonly ChatSearchableMessage[]
): ChatSearchIndexEntry[] {
	let currentAnchorMessageId: string | null = null;
	return messages.map((message) => {
		if (message.role === "user") {
			currentAnchorMessageId = message.id;
		}
		const content = chatMessageText(message);
		return {
			anchorMessageId: currentAnchorMessageId ?? message.id,
			content,
			messageId: message.id,
			role: message.role?.trim() || "message",
			normalizedContent: content.toLocaleLowerCase(),
		};
	});
}

/** Find literal, case-insensitive matches without normalizing history per keypress. */
export function searchChatIndex(
	index: readonly ChatSearchIndexEntry[],
	query: string
): ChatSearchMatch[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) {
		return [];
	}
	const matches: ChatSearchMatch[] = [];
	for (const entry of index) {
		if (entry.normalizedContent.includes(normalizedQuery)) {
			const { normalizedContent: _, ...match } = entry;
			matches.push(match);
		}
	}
	return matches;
}

/** One-shot search for callers that do not retain an index. */
export function searchChatMessages(
	messages: readonly ChatSearchableMessage[],
	query: string
): ChatSearchMatch[] {
	if (!query.trim()) {
		return [];
	}
	return searchChatIndex(buildChatSearchIndex(messages), query);
}
