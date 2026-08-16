export interface KeymapEntry {
	group: string;
	keys: string;
	label: string;
}

/** The shortcuts users can invoke while the chat surface owns the keyboard. */
export const CHAT_KEYMAP: readonly KeymapEntry[] = [
	{ group: "Chat", keys: "Enter", label: "send message" },
	{ group: "Chat", keys: "↑ / ↓", label: "prompt history" },
	{ group: "Chat", keys: "Esc", label: "stop streaming / close overlay" },
	{ group: "Chat", keys: "Ctrl+A", label: "choose agent" },
	{ group: "Chat", keys: "Ctrl+R", label: "choose ACP settings" },
	{ group: "Chat", keys: "Ctrl+L", label: "start a new conversation" },
	{ group: "Chat", keys: "Ctrl+?", label: "show this keymap" },
	{ group: "Commands", keys: "/model", label: "choose or clear the model" },
	{ group: "Commands", keys: "/sessions", label: "list recent sessions" },
	{ group: "Commands", keys: "/fork", label: "fork the conversation" },
	{ group: "Commands", keys: "/pin", label: "pin or unpin the session" },
	{ group: "Commands", keys: "/resume", label: "resume a conversation" },
	{ group: "Commands", keys: "/rename", label: "rename a conversation" },
	{ group: "Commands", keys: "/delete", label: "delete a conversation" },
	{ group: "Navigation", keys: "Ctrl+K", label: "open command palette" },
	{ group: "Navigation", keys: "Ctrl+T", label: "open a new tab" },
	{ group: "Navigation", keys: "Ctrl+W", label: "close the active tab" },
	{ group: "Navigation", keys: "Alt+← / →", label: "move between panes" },
];

export function keymapGroups(
	entries: readonly KeymapEntry[] = CHAT_KEYMAP
): { group: string; entries: KeymapEntry[] }[] {
	const groups: { group: string; entries: KeymapEntry[] }[] = [];
	for (const entry of entries) {
		let group = groups.find((candidate) => candidate.group === entry.group);
		if (!group) {
			group = { group: entry.group, entries: [] };
			groups.push(group);
		}
		group.entries.push(entry);
	}
	return groups;
}
