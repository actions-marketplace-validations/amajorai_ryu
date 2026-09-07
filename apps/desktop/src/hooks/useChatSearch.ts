import { useMemo } from "react";
import {
	buildChatSearchIndex,
	type ChatSearchableMessage,
	searchChatIndex,
} from "../lib/chat-search.ts";

/** Keep history normalization off the typing path, and do no work while inactive. */
export function useChatSearch(
	messages: readonly ChatSearchableMessage[],
	query: string,
	enabled: boolean
) {
	const active = enabled && query.trim().length > 0;
	const index = useMemo(
		() => (active ? buildChatSearchIndex(messages) : []),
		[active, messages]
	);
	return useMemo(() => searchChatIndex(index, query), [index, query]);
}
