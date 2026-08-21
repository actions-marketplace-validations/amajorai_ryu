// apps/desktop/src/components/chat/SideChatPanel.tsx
//
// The `/btw` side question, as a right-panel workspace tab (it used to be a
// modal Dialog, which is the wrong shape: a side question is a thing you keep
// beside the conversation and glance back at, not a thing that blocks the chat
// until dismissed). The panel is opened programmatically by ChatPage — same
// one-reusable-tab + nonce-refocus flow as the subagent / artifact / inspector
// panels (see WorkspacePanels).
//
// It also OWNS asking: the composer at the bottom starts a new side chat without
// going back to the main input, which is what the Context rail's "New side chat"
// button opens.

import { AgentChat } from "@ryu/blocks/desktop/agent-elements/agent-chat";
import type {
	ComposerMenuGroup,
	ComposerMenuItem,
} from "@ryu/blocks/desktop/agent-elements/input/composer-menu";
import type { MentionItem } from "@ryu/blocks/desktop/agent-elements/types";
import type { UIMessage } from "ai";
import { useCallback, useMemo } from "react";

/** State of the `/btw` side question currently shown in the panel. */
export interface SideChatState {
	/** The answer once it arrives (Markdown), or null while loading/errored. */
	answer: string | null;
	/** An error message when the side question failed. */
	error: string | null;
	/** True while the answer is being fetched. */
	loading: boolean;
	/** The model that answered (resolved server-side). */
	model: string | null;
	/** The side question the user asked. Empty = the panel is in "ask" mode. */
	question: string;
}

/** Everything the side-chat tab needs, kept current on every render (unlike the
 *  open REQUEST, which only carries a nonce). */
export interface SideChatData {
	composerMenuGroups?: ComposerMenuGroup[];
	mentionItems?: MentionItem[];
	/** Ask a (new) side question. The host runs it and updates `state`. */
	onAsk: (question: string) => void;
	onComposerMenuSelect?: (item: ComposerMenuItem) => void;
	/** The current side question, or null when nothing has been asked yet. */
	state: SideChatState | null;
}

/** The empty "ask a side question" state — no question asked yet. */
export const EMPTY_SIDE_CHAT: SideChatState = {
	question: "",
	loading: false,
	answer: null,
	model: null,
	error: null,
};

export function SideChatPanel({
	state,
	onAsk,
	composerMenuGroups,
	mentionItems,
	onComposerMenuSelect,
}: SideChatData) {
	const messages = useMemo<UIMessage[]>(() => {
		if (!state?.question) {
			return [];
		}
		const next: UIMessage[] = [
			{
				id: "side-question",
				parts: [{ text: state.question, type: "text" }],
				role: "user",
			},
		];
		if (state.answer) {
			next.push({
				id: "side-answer",
				parts: [{ text: state.answer, type: "text" }],
				role: "assistant",
			});
		}
		return next;
	}, [state]);
	const handleSend = useCallback(
		(message: { role: "user"; content: string }) => onAsk(message.content),
		[onAsk]
	);
	const asking = messages.length === 0 && !state?.error;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<AgentChat
				composerMenuGroups={composerMenuGroups}
				density="compact"
				emptyStateHeader={
					asking ? (
						<p className="mb-3 text-center text-muted-foreground text-xs leading-relaxed">
							Ask something about this conversation. The side model sees the
							chat but has no tools, and the answer never enters the transcript.
						</p>
					) : undefined
				}
				emptyStatePosition="center"
				error={state?.error ? new Error(state.error) : undefined}
				mentionItems={mentionItems}
				messages={messages}
				onComposerMenuSelect={onComposerMenuSelect}
				onSend={handleSend}
				onStop={() => undefined}
				showCopyToolbar
				status={state?.loading ? "streaming" : "ready"}
			/>
			{state?.model ? (
				<span className="shrink-0 px-3 pb-2 text-[11px] text-muted-foreground">
					{state.model} · not in the transcript
				</span>
			) : null}
		</div>
	);
}
