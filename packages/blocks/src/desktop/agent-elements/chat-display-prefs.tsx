"use client";

import { createContext, useContext } from "react";

/**
 * Global display preferences for the chat message list. Consumed by tool
 * renderers (ToolGroup, EditTool) to honour user settings without prop-drilling.
 * The desktop wraps the message list with `<ChatDisplayPrefsProvider>` and reads
 * values from localStorage-backed hooks.
 */
export interface ChatDisplayPrefs {
	/**
	 * How much room the transcript gives each turn.
	 * - "comfortable" (default): the full desktop chat — centred 720px column,
	 *   generous padding, floating table of contents, pinned user message.
	 * - "compact": the same components in a narrow surface (the island's mini
	 *   chat, a companion popover). Tighter padding, no centring column, and the
	 *   reading aids that need width (TOC, pinned bar) are dropped.
	 *
	 * This is the ONE knob that makes the desktop message list reusable in a small
	 * surface — the alternative is a second transcript implementation that drifts
	 * every time the desktop one gains a part type.
	 */
	density: "comfortable" | "compact";
	/**
	 * When true, fenced code blocks in assistant markdown render at their full
	 * height. When false, a long block is capped and scrolls inside its own box,
	 * so one 300-line paste cannot bury the rest of the reply.
	 *
	 * This is the "Tool detail" knob reaching past tool calls: a reply's code is
	 * the same kind of bulk the Bash/Edit caps already govern, and capping it is
	 * what makes the Compact level actually compact. Capped means SCROLLABLE, not
	 * clipped — code the model wrote must always stay readable and selectable.
	 * Default: false (capped).
	 */
	expandCodeBlocks: boolean;
	/**
	 * When true, bash/command tool output renders fully expanded (no height cap).
	 * When false, output is capped at a few lines with overflow hidden.
	 * Default: false (collapsed).
	 */
	expandCommands: boolean;
	/**
	 * When true, file edit diffs (Edit/Write tool) render expanded by default.
	 * When false, they start collapsed and require a click to expand.
	 * Default: false (collapsed).
	 */
	expandFileEdits: boolean;
	/**
	 * When true, consecutive tool calls (Task/Agent) are collapsed into a single
	 * grouped row with a summary. When false, every tool call renders individually.
	 * Default: true.
	 */
	groupToolUses: boolean;
	/**
	 * When true, opening a conversation jumps the transcript to the newest message
	 * instead of leaving it wherever the scroller happened to settle while the
	 * history was still loading. The jump fires once per conversation (on mount,
	 * on hydration, and when the surface first gains layout — a tab restored
	 * behind `display:none` has none), never mid-read. Default: true.
	 */
	openAtBottom: boolean;
	/**
	 * When true, the latest scrolled-past user message stays pinned at the top of
	 * the chat while reading a long assistant reply (Cursor-style). Default: true.
	 */
	pinUserMessage: boolean;
	/**
	 * When true, streaming assistant markdown fades/blurs in word-by-word as it
	 * arrives (Streamdown's animate plugin). The desktop resolves this from the
	 * global "Enable animations" master toggle, the per-feature stream toggle, and
	 * the OS `prefers-reduced-motion` setting (any of which off ⇒ false).
	 * Default: true.
	 */
	streamAnimation: boolean;
}

const DEFAULT_PREFS: ChatDisplayPrefs = {
	density: "comfortable",
	groupToolUses: true,
	expandFileEdits: false,
	expandCommands: false,
	expandCodeBlocks: false,
	openAtBottom: true,
	pinUserMessage: true,
	streamAnimation: true,
};

const ChatDisplayPrefsContext = createContext<ChatDisplayPrefs>(DEFAULT_PREFS);

export function ChatDisplayPrefsProvider({
	children,
	value,
}: {
	children: React.ReactNode;
	value: Partial<ChatDisplayPrefs>;
}) {
	const merged = { ...DEFAULT_PREFS, ...value };
	return (
		<ChatDisplayPrefsContext.Provider value={merged}>
			{children}
		</ChatDisplayPrefsContext.Provider>
	);
}

export function useChatDisplayPrefs(): ChatDisplayPrefs {
	return useContext(ChatDisplayPrefsContext);
}
