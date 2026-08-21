import { describe, expect, test } from "bun:test";
import {
	buildSideChatContext,
	EXPANDED_COMPOSER_FEATURE_KIND,
	EXPANDED_COMPOSER_PLUGIN_ID,
	GHOST_CHAT_FEATURE_KIND,
	GHOST_CHATS_PLUGIN_ID,
	hasPluginChatFeature,
	SIDE_CHAT_FEATURE_KIND,
	SIDE_CHATS_PLUGIN_ID,
} from "./plugin-chat-features.ts";

describe("plugin chat feature detection", () => {
	test("matches an enabled, server-tagged side-chat feature", () => {
		expect(
			hasPluginChatFeature(
				[
					{
						kind: SIDE_CHAT_FEATURE_KIND,
						plugin: SIDE_CHATS_PLUGIN_ID,
					},
				],
				SIDE_CHATS_PLUGIN_ID,
				SIDE_CHAT_FEATURE_KIND
			)
		).toBe(true);
	});

	test("does not let a different plugin impersonate temporary chats", () => {
		expect(
			hasPluginChatFeature(
				[{ kind: GHOST_CHAT_FEATURE_KIND, plugin: "@acme/ghost" }],
				GHOST_CHATS_PLUGIN_ID,
				GHOST_CHAT_FEATURE_KIND
			)
		).toBe(false);
	});

	test("detects the plugin-owned expanded composer feature", () => {
		expect(
			hasPluginChatFeature(
				[
					{
						kind: EXPANDED_COMPOSER_FEATURE_KIND,
						plugin: EXPANDED_COMPOSER_PLUGIN_ID,
					},
				],
				EXPANDED_COMPOSER_PLUGIN_ID,
				EXPANDED_COMPOSER_FEATURE_KIND
			)
		).toBe(true);
	});
});

test("side-chat context keeps the visible main chat and bounds it", () => {
	expect(
		buildSideChatContext(
			[
				{ content: "hidden system detail", role: "system" },
				{ content: "first", role: "user" },
				{ parts: [{ text: "latest answer", type: "text" }], role: "assistant" },
			],
			2
		)
	).toEqual([
		{ content: "first", role: "user" },
		{ content: "latest answer", role: "assistant" },
	]);
});
