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

import { Copy01Icon, SentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TextShimmer } from "@ryu/blocks/desktop/agent-elements/text-shimmer";
import { Button } from "@ryu/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { sileo } from "sileo";
import { Markdown } from "@/components/agent-elements/markdown.tsx";

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
	/** Ask a (new) side question. The host runs it and updates `state`. */
	onAsk: (question: string) => void;
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

export function SideChatPanel({ state, onAsk }: SideChatData) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Focus the composer whenever the panel lands in "ask" mode (a fresh side
	// chat), so "New side chat" is one click and then typing.
	const asking = !(state && (state.question || state.loading));
	useEffect(() => {
		if (asking) {
			inputRef.current?.focus();
		}
	}, [asking]);

	const copyAnswer = () => {
		if (!state?.answer) {
			return;
		}
		navigator.clipboard
			.writeText(state.answer)
			.then(() => sileo.success({ title: "Answer copied" }))
			.catch(() => sileo.error({ title: "Could not copy answer" }));
	};

	const submit = () => {
		const question = draft.trim();
		if (!question) {
			return;
		}
		setDraft("");
		onAsk(question);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="scroll-fade min-h-0 flex-1 overflow-y-auto p-3">
				{state?.question && (
					<p className="mb-2 font-medium text-foreground text-sm leading-snug">
						{state.question}
					</p>
				)}
				{state?.loading && (
					<TextShimmer className="text-muted-foreground text-sm">
						Thinking…
					</TextShimmer>
				)}
				{state?.error && (
					<p className="text-destructive text-sm">{state.error}</p>
				)}
				{state?.answer && (
					<Markdown className="text-sm" content={state.answer} />
				)}
				{asking && !state?.error && (
					<p className="text-muted-foreground text-xs leading-relaxed">
						Ask something about this conversation. The side model sees the chat
						but has no tools, and the answer never enters the transcript.
					</p>
				)}
			</div>

			<div className="shrink-0 border-border/60 border-t p-2">
				{(state?.answer || state?.model) && (
					<div className="mb-2 flex items-center justify-between gap-2">
						<span className="min-w-0 truncate text-[11px] text-muted-foreground">
							{state?.model
								? `${state.model} · not in the transcript`
								: "Not in the transcript"}
						</span>
						{state?.answer && (
							<Button
								onClick={copyAnswer}
								size="sm"
								type="button"
								variant="ghost"
							>
								<HugeiconsIcon className="size-3.5" icon={Copy01Icon} />
								Copy
							</Button>
						)}
					</div>
				)}
				<div className="flex items-end gap-1.5 rounded-lg border border-border/70 bg-background p-1.5">
					<textarea
						className="max-h-32 min-h-7 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit();
							}
						}}
						placeholder="Ask a side question…"
						ref={inputRef}
						rows={1}
						value={draft}
					/>
					<Button
						aria-label="Ask side question"
						disabled={!draft.trim()}
						onClick={submit}
						size="icon"
						type="button"
						variant="ghost"
					>
						<HugeiconsIcon className="size-4" icon={SentIcon} />
					</Button>
				</div>
			</div>
		</div>
	);
}
