import type { BtwMessage } from "@/src/lib/api/btw.ts";
import type { PluginChatFeature } from "@/src/lib/api/plugins.ts";

export const SIDE_CHATS_PLUGIN_ID = "@ryu/side-chats";
export const GHOST_CHATS_PLUGIN_ID = "@ryu/ghost-chats";
export const EXPANDED_COMPOSER_PLUGIN_ID = "@ryu/expanded-composer";
export const STATS_PLUGIN_ID = "@ryu/stats";

export const SIDE_CHAT_FEATURE_KIND = "side-chat";
export const GHOST_CHAT_FEATURE_KIND = "ghost-chat";
export const EXPANDED_COMPOSER_FEATURE_KIND = "expanded-composer";
export const STATS_FEATURE_KIND = "session-stats";

/** Dispatch tag used by the Side Chats plugin's selection-toolbar actions. */
export const SIDE_CHAT_SELECTION_DISPATCH = "side-chat.selection";

export type SideChatSelectionIntent = "ask" | "explain";

export interface MainChatContextMessage {
	content?: string;
	parts?: readonly unknown[];
	role?: string;
}

/** Feature-detect one host-rendered chat behavior from the enabled-plugin feed. */
export function hasPluginChatFeature(
	features: readonly PluginChatFeature[],
	pluginId: string,
	kind: string
): boolean {
	return features.some(
		(feature) => feature.plugin === pluginId && feature.kind === kind
	);
}

/** Build the bounded transcript a side-chat plugin sends to `/api/btw`. */
export function buildSideChatContext(
	messages: readonly MainChatContextMessage[],
	limit = 30
): BtwMessage[] {
	const context: BtwMessage[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}
		const content = textFromMessage(message).trim();
		if (content) {
			context.push({ content, role: message.role });
		}
	}
	const boundedLimit = Math.max(0, Math.floor(limit));
	return boundedLimit === 0 ? [] : context.slice(-boundedLimit);
}

/** Build the side question sent when a user invokes a contributed selection
 * action. The visible main-chat transcript is sent separately as context, so
 * the selected text is explicit and cannot be confused with an older turn. */
export function buildSideChatSelectionQuestion(
	intent: SideChatSelectionIntent,
	text: string
): string {
	const selected = text.trim().slice(0, 6000);
	const quoted = selected
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	if (intent === "explain") {
		return `Explain this highlighted text using the current main-chat context. Clarify any references or assumptions from the conversation, and do not invent facts outside it.\n\nHIGHLIGHTED TEXT:\n${quoted}`;
	}
	return `Answer this highlighted text as a side question using the current main-chat context.\n\nHIGHLIGHTED TEXT:\n${quoted}`;
}

function textFromMessage(message: MainChatContextMessage): string {
	if (Array.isArray(message.parts) && message.parts.length > 0) {
		return message.parts
			.map((part) => {
				if (typeof part !== "object" || part === null) {
					return "";
				}
				const record = part as { text?: unknown; type?: unknown };
				return record.type === "text" && typeof record.text === "string"
					? record.text
					: "";
			})
			.join("\n\n");
	}
	return typeof message.content === "string" ? message.content : "";
}
