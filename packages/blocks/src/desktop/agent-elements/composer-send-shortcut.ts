export type ComposerSendShortcut = "enter" | "shift-enter" | "command-enter";

export interface ComposerKeyEvent {
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}

export interface ComposerKeyAction {
	followUpMode?: "opposite";
	kind: "send" | "newline" | "ignore";
}

export function resolveComposerKeyAction(
	shortcut: ComposerSendShortcut,
	event: ComposerKeyEvent
): ComposerKeyAction {
	if (event.key !== "Enter") {
		return { kind: "ignore" };
	}

	if (event.shiftKey) {
		return {
			kind: shortcut === "shift-enter" ? "send" : "newline",
		};
	}

	const command = event.metaKey || event.ctrlKey;

	if (shortcut === "command-enter") {
		return {
			kind: command ? "send" : "newline",
		};
	}

	if (command) {
		return {
			kind: "send",
			followUpMode: "opposite",
		};
	}

	return {
		kind: shortcut === "enter" ? "send" : "newline",
	};
}
