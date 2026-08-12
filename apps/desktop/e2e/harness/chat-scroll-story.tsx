// Standalone browser story for the REAL chat transcript (`MessageList`, via the
// desktop's own `@/components/agent-elements/message-list.tsx` shim) opening on a
// conversation whose history arrives AFTER mount — the shape ChatPage produces,
// where `loadMessages(convId).then(setMessages)` resolves a tick or two after the
// scroller has already mounted and measured an empty list.
//
// The question this exists to answer: does opening a chat land on the NEWEST
// message? That cannot be read off the code. The scroller positions itself when
// content first appears, but the transcript's items carry
// `content-visibility:auto` with a 10rem intrinsic estimate, so the height it
// measures at that moment is a guess that grows as items render for real — and a
// tab restored behind `display:none` has no layout at all when its history lands.
// Only a real browser layout resolves where the viewport actually ends up.
//
// Three cases are mounted from one page, selected by query string:
//   (default)      visible surface, history arrives after mount
//   ?hidden=1      surface mounts inside `display:none` (a restored background
//                  tab) and is revealed after the history lands
//   ?pref=off      the Appearance toggle is off — the transcript must be left
//                  wherever it loaded, NOT yanked to the bottom
//
// The pref is read through the REAL desktop provider (`ChatDisplayPrefs`, backed
// by the `ryu:open-chat-at-bottom` localStorage toggle), so this covers the
// settings plumbing and not just the blocks-level default.
//
// HARNESS LIMIT: this asserts final scroll geometry. It says nothing about how
// the jump feels (instant vs animated).

import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/agent-elements/agent-chat.tsx";
import { ChatDisplayPrefs } from "../../src/components/chat/ChatDisplayPrefsProvider.tsx";
import "../../src/index.css";

/** Enough turns that the transcript is many viewports tall. */
const TURN_COUNT = 40;

/** How long ChatPage's history fetch is stood in for. */
const HYDRATION_DELAY_MS = 60;

const params = new URLSearchParams(window.location.search);
const startsHidden = params.get("hidden") === "1";
const prefOff = params.get("pref") === "off";

// The story drives the REAL persisted toggle rather than the context default, so
// the "off" case exercises the same read path the Appearance switch writes to.
try {
	localStorage.setItem("ryu:open-chat-at-bottom", prefOff ? "false" : "true");
} catch {
	// Persistence is best-effort; the provider falls back to the default.
}

function buildHistory(thread: string): UIMessage[] {
	const messages: UIMessage[] = [];
	for (let i = 0; i < TURN_COUNT; i += 1) {
		messages.push({
			id: `${thread}-user-${i}`,
			role: "user",
			parts: [{ type: "text", text: `Question ${i} about the codebase` }],
		} as unknown as UIMessage);
		messages.push({
			id: `${thread}-assistant-${i}`,
			role: "assistant",
			parts: [
				{
					type: "text",
					// Long enough that a turn is taller than the 10rem intrinsic size
					// the transcript's `content-visibility` items estimate with.
					text: `Answer ${i}.\n\n${"The reply runs on for several lines so each turn is taller than the placeholder estimate. ".repeat(6)}`,
				},
			],
		} as unknown as UIMessage);
	}
	return messages;
}

function Story() {
	const [messages, setMessages] = useState<UIMessage[]>([]);
	const [hidden, setHidden] = useState(startsHidden);
	// Selecting a different chat inside a live transcript (sidebar click on a tab
	// that is already open) swaps the history without remounting anything.
	const [thread, setThread] = useState("conv-a");

	// Mirrors ChatPage: the conversation id is known at mount, its history is not.
	useEffect(() => {
		const historyTimer = window.setTimeout(() => {
			setMessages(buildHistory(thread));
		}, HYDRATION_DELAY_MS);
		return () => window.clearTimeout(historyTimer);
	}, [thread]);

	return (
		<div className="flex h-screen flex-col bg-background">
			<div
				data-message-count={messages.length}
				data-testid="story-state"
				data-thread={thread}
			>
				{hidden ? "hidden" : "visible"}
			</div>
			<button
				data-testid="reveal"
				onClick={() => setHidden(false)}
				type="button"
			>
				Reveal
			</button>
			<button
				data-testid="switch-conversation"
				onClick={() => {
					setMessages([]);
					setThread("conv-b");
				}}
				type="button"
			>
				Switch conversation
			</button>
			{/* A hidden tab is `display:none` in Layout — mounted, live, no layout. */}
			<div
				className="flex min-h-0 flex-1 flex-col"
				style={hidden ? { display: "none" } : undefined}
			>
				<ChatDisplayPrefs>
					{/* Through `AgentChat`, exactly as ChatPage mounts it: with
					    `emptyStatePosition="center"` the transcript is not rendered at
					    all while the thread is empty, so the history landing MOUNTS the
					    message list rather than filling one that was already there. */}
					<AgentChat
						conversationKey={thread}
						// ChatPage always passes an object literal here, so a user turn
						// ALWAYS carries an avatar in the real app. Without it the story
						// lays out a one-child row the product never renders, and the
						// row's right edge is not the one the user sees.
						currentUser={{ id: "me", name: "You" }}
						emptyStatePosition="center"
						messages={messages}
						// Present purely so the hover toolbar has buttons to align; the
						// story never branches or edits.
						onBranch={() => {
							// no-op
						}}
						onEditMessage={() => {
							// no-op
						}}
						onSend={() => {
							// The story never sends; the composer is here because the real
							// surface always carries one.
						}}
						status="ready"
					/>
				</ChatDisplayPrefs>
			</div>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
