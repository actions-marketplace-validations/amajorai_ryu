"use client";

// The island's transcript IS the desktop transcript.
//
// Everything the desktop chat renders — tool rows, MCP widgets, image
// generation, reasoning, citations, file parts, error cards — comes from
// `@ryu/blocks/desktop/agent-elements/message-list`. The island used to ship a
// hand-rolled plain-text list, so every part type the desktop gained (a new tool
// renderer, a widget) silently rendered as nothing here. This file is the seam
// that stops that drift: one component, two densities.
//
// What the island supplies is the *density*, not a second implementation:
// `density: "compact"` drops the reading aids that need width (the floating TOC,
// the pinned user-message bar, the centred 720px column) and tightens padding.
// A new desktop part type shows up here for free.
//
// Not reused: the composer. The island's blended glass input is a genuinely
// different control from the desktop InputBar, so `MessageInput` stays island-owned.

import type { ChatStatus, UIMessage } from "ai";
import type { ComponentProps } from "react";
import { ChatDisplayPrefsProvider } from "../../desktop/agent-elements/chat-display-prefs.tsx";
import { MessageList } from "../../desktop/agent-elements/message-list.tsx";

type MessageListProps = ComponentProps<typeof MessageList>;

export interface IslandTranscriptProps {
	/** Assistant avatar. Off by default — the island bar is ~380px wide. */
	assistantAvatar?: MessageListProps["assistantAvatar"];
	assistantName?: MessageListProps["assistantName"];
	className?: string;
	messages: UIMessage[];
	/** Fork this turn into a new chat. Omitted ⇒ no branch button. */
	onBranch?: MessageListProps["onBranch"];
	onOpenFile?: MessageListProps["onOpenFile"];
	onRegenerateMessage?: MessageListProps["onRegenerateMessage"];
	/** Speak an assistant turn aloud. The island wires this to Core's TTS. */
	onSpeak?: MessageListProps["onSpeak"];
	/** Same slot contract as the desktop chat (custom InputBar/UserMessage). */
	slots?: MessageListProps["slots"];
	status: ChatStatus;
	/** Per-tool overrides, same registry the desktop passes. */
	toolRenderers?: MessageListProps["toolRenderers"];
}

export function IslandTranscript({
	assistantAvatar,
	assistantName,
	className,
	messages,
	onBranch,
	onOpenFile,
	onRegenerateMessage,
	onSpeak,
	slots,
	status,
	toolRenderers,
}: IslandTranscriptProps) {
	return (
		<ChatDisplayPrefsProvider
			value={{
				density: "compact",
				// Long bash output and file diffs would swallow the whole island;
				// they stay collapsed behind their disclosure here regardless of the
				// desktop's own setting.
				expandCommands: false,
				expandFileEdits: false,
				pinUserMessage: false,
			}}
		>
			<MessageList
				assistantAvatar={assistantAvatar}
				assistantName={assistantName}
				className={className}
				messages={messages}
				onBranch={onBranch}
				onOpenFile={onOpenFile}
				onRegenerateMessage={onRegenerateMessage}
				onSpeak={onSpeak}
				showCopyToolbar
				slots={slots}
				status={status}
				toolRenderers={toolRenderers}
			/>
		</ChatDisplayPrefsProvider>
	);
}
