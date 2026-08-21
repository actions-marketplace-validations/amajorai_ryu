import type { BtwMessage } from "@/src/lib/api/btw.ts";
import type { PluginChatFeature } from "@/src/lib/api/plugins.ts";

export const SIDE_CHATS_PLUGIN_ID = "@ryu/side-chats";
export const GHOST_CHATS_PLUGIN_ID = "@ryu/ghost-chats";
export const EXPANDED_COMPOSER_PLUGIN_ID = "@ryu/expanded-composer";

export const SIDE_CHAT_FEATURE_KIND = "side-chat";
export const GHOST_CHAT_FEATURE_KIND = "ghost-chat";
export const EXPANDED_COMPOSER_FEATURE_KIND = "expanded-composer";

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
