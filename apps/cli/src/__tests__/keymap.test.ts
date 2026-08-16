import { expect, test } from "bun:test";
import { CHAT_KEYMAP, keymapGroups } from "../core/keymap.ts";

test("groups keymap entries in display order", () => {
	const groups = keymapGroups();

	expect(groups.map(({ group }) => group)).toEqual([
		"Chat",
		"Commands",
		"Navigation",
	]);
	expect(groups[0]?.entries[0]).toEqual({
		group: "Chat",
		keys: "Enter",
		label: "send message",
	});
});

test("keymap documents every chat-owned modified shortcut", () => {
	const shortcuts = new Set(CHAT_KEYMAP.map((entry) => entry.keys));

	for (const shortcut of ["Ctrl+A", "Ctrl+R", "Ctrl+L", "Ctrl+?"]) {
		expect(shortcuts.has(shortcut)).toBe(true);
	}
});
