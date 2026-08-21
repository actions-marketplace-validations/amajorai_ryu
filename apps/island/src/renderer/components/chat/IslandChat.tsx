// The expanded-island mini chat wrapper. The presentational body lives in the
// shared desktop `AgentChat`; this file owns the chat state via
// useIslandChat, the Core reachability probe, the store prefill, and reports both
// whether there is history (so the island grows from a compact composer bar to the
// full panel) and the composer's height (so the compact bar tracks the draft).
//
// The transcript and composer are both shared primitives at compact density, so
// tool rows, MCP widgets, generated images, mentions, and directory dropdowns do
// not need island-local ports.

import { handleComposerSettingsShortcut } from "@ryu/blocks/composer/composer-shortcuts";
import { AgentChat } from "@ryu/blocks/desktop/agent-elements/agent-chat";
import {
	InputBar,
	type InputBarProps,
} from "@ryu/blocks/desktop/agent-elements/input-bar";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIslandComposerContext } from "../../context/island-composer-context.tsx";
import { useComposerShortcutBindings } from "../../hooks/use-composer-shortcut-bindings.ts";
import { IslandWidgetHost } from "../../host/IslandWidgetHost.tsx";
import { useIslandState } from "../../store/island-state.ts";
import { useIslandChat } from "./use-island-chat.ts";

type Reachability = "checking" | "offline" | "online";

export function IslandChat() {
	const {
		leftActions,
		composerMenuGroups,
		mentionItems,
		onComposerMenuSelect,
		getAcpPayload,
		sections,
		applyStreamedAcpConfig,
		applyStreamedAcpMode,
	} = useIslandComposerContext();
	const composerShortcuts = useComposerShortcutBindings();
	// Session-scoped double-check toggle. Read via a getter so useIslandChat's
	// `send` callback never closes over a stale value.
	const [doubleCheck, setDoubleCheck] = useState(false);
	const doubleCheckRef = useRef(doubleCheck);
	doubleCheckRef.current = doubleCheck;
	const { messages, status, error, notes, send, stop, clearNotes } =
		useIslandChat({
			getAcpPayload,
			getDoubleCheck: () => doubleCheckRef.current,
			// Agent-driven session-control write-backs go straight back into the
			// composer's ACP state, so the next turn sends what the agent asked for.
			onAcpConfig: applyStreamedAcpConfig,
			onAcpMode: applyStreamedAcpMode,
		});
	const chatPrefill = useIslandState((store) => store.chatPrefill);
	const clearChatPrefill = useIslandState((store) => store.clearChatPrefill);
	const setExpandedTall = useIslandState((store) => store.setExpandedTall);
	const setComposerHeight = useIslandState((store) => store.setComposerHeight);
	const pendingAttachments = useIslandState(
		(store) => store.pendingAttachments
	);
	const removeAttachment = useIslandState((store) => store.removeAttachment);
	const clearAttachments = useIslandState((store) => store.clearAttachments);
	const attachAndOpen = useIslandState((store) => store.attachAndOpen);
	const [reachability, setReachability] = useState<Reachability>("checking");

	// The island is a short composer bar until a conversation exists, then it grows
	// to the full panel height.
	const hasHistory = messages.length > 0;
	useEffect(() => {
		setExpandedTall(hasHistory);
	}, [hasHistory, setExpandedTall]);

	const probe = useCallback(async (): Promise<void> => {
		setReachability("checking");
		const result = await window.island.core.health();
		setReachability(result.available ? "online" : "offline");
	}, []);

	useEffect(() => {
		probe().catch(() => setReachability("offline"));
	}, [probe]);

	const offline = reachability === "offline";

	// Action pills (double-check, and future plugin composer actions) live in their
	// own strip BELOW the composer, not crammed at its left edge — so they stay
	// visible and tappable. The composer's left edge keeps only the agent/model
	// picker (`leftActions`).
	const belowInputActions = (
		<button
			aria-pressed={doubleCheck}
			className={`shrink-0 rounded-full border px-2.5 py-1 font-medium text-[11px] transition-colors ${
				doubleCheck
					? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
					: "border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
			}`}
			onClick={() => setDoubleCheck((prev) => !prev)}
			title="Have Ryu review each answer before replying"
			type="button"
		>
			Double-check
		</button>
	);

	const onComposerKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
			handleComposerSettingsShortcut(event, sections, composerShortcuts),
		[sections, composerShortcuts]
	);
	const onAttach = useCallback(() => {
		void window.island.system
			.attachFiles()
			.then(attachAndOpen)
			.catch(() => undefined);
	}, [attachAndOpen]);
	const sendTurn = useCallback(
		(text: string) => {
			const attachments = useIslandState.getState().pendingAttachments;
			void Promise.resolve(send(text, { withScreen: true, attachments })).catch(
				() => undefined
			);
			clearAttachments();
		},
		[clearAttachments, send]
	);
	const inputBarPropsRef = useRef<{
		leftActions: ReactNode;
		onAttach: () => void;
		onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
	}>({ leftActions, onAttach, onComposerKeyDown });
	inputBarPropsRef.current = { leftActions, onAttach, onComposerKeyDown };
	const islandInputBar = useMemo(
		() =>
			function IslandInputBar(props: InputBarProps) {
				const live = inputBarPropsRef.current;
				return (
					<InputBar
						{...props}
						compact
						leftActions={live.leftActions}
						onAttach={live.onAttach}
						onTextareaKeyDown={(event) => {
							if (
								live.onComposerKeyDown(
									event as KeyboardEvent<HTMLTextAreaElement>
								)
							) {
								return;
							}
							props.onTextareaKeyDown?.(event);
						}}
					/>
				);
			},
		[]
	);
	const handleAgentUiSubmit = useCallback(
		(value: unknown) => {
			const content =
				typeof value === "string"
					? value
					: (JSON.stringify(value) ?? String(value));
			sendTurn(content);
		},
		[sendTurn]
	);

	return (
		<div className="flex h-full w-full flex-col gap-2">
			{notes.length > 0 ? (
				<div className="relative z-20 shrink-0 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5">
					<div className="flex items-start justify-between gap-2">
						<span className="font-semibold text-[10px] text-amber-300/90 uppercase tracking-wide">
							Note
						</span>
						<button
							aria-label="Dismiss notes"
							className="shrink-0 text-amber-200/70 hover:text-amber-100"
							onClick={clearNotes}
							type="button"
						>
							<svg
								aria-hidden="true"
								fill="none"
								height="10"
								stroke="currentColor"
								strokeLinecap="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
								width="10"
							>
								<path d="M18 6 6 18M6 6l12 12" />
							</svg>
						</button>
					</div>
					{notes.map((note, index) => (
						<p
							className="mt-0.5 text-amber-100/90 text-xs leading-snug"
							// biome-ignore lint/suspicious/noArrayIndexKey: notes are append-only, ephemeral, and never reordered
							key={index}
						>
							{note}
						</p>
					))}
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col">
				{offline ? (
					<p className="relative z-10 shrink-0 text-neutral-400 text-xs">
						Can't reach Ryu Core.{" "}
						<button
							className="text-neutral-200 underline underline-offset-2 hover:text-neutral-100"
							onClick={probe}
							type="button"
						>
							Retry
						</button>
					</p>
				) : null}
				<div className="min-h-0 flex-1">
					<IslandWidgetHost>
						<AgentChat
							attachments={{
								images: pendingAttachments.map((attachment) => ({
									filename: attachment.name,
									id: attachment.path,
									mimeType: attachment.mimeType,
									url: attachment.dataUrl,
								})),
								onRemoveImage: removeAttachment,
							}}
							composerDisabled={offline}
							composerFooter={belowInputActions}
							composerMenuGroups={composerMenuGroups}
							density="compact"
							error={error ? new Error(error) : undefined}
							mentionItems={mentionItems}
							messages={messages}
							onAgentUiSubmit={handleAgentUiSubmit}
							onComposerMenuSelect={onComposerMenuSelect}
							onComposerResize={setComposerHeight}
							onSeedDraftConsumed={clearChatPrefill}
							onSend={(message) => sendTurn(message.content)}
							onStop={stop}
							seedDraft={chatPrefill ?? undefined}
							slots={{ InputBar: islandInputBar }}
							status={status}
						/>
					</IslandWidgetHost>
				</div>
			</div>
		</div>
	);
}
