"use client";

import { ArrowDown01Icon, Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import { Spinner } from "@ryu/ui/components/spinner";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { AgentAvatar, engineForAgent } from "@/src/lib/agent-logos.tsx";
import type { Message } from "@/types/chat.ts";

interface MessageEntry {
	description?: string;
	id: string;
	title: string;
}

/**
 * Lazily-loaded list of user turns for a conversation, shown indented under
 * its sidebar row. Clicking a turn opens the chat and scrolls to that message.
 * Hovering a turn shows a preview popover with the user message and the first
 * assistant reply (like the TOC popover in the chat page).
 */
export function SidebarChatMessages({
	agentId,
	conversationId,
	loadMessages,
	onJump,
}: {
	agentId?: string;
	conversationId: string;
	loadMessages: (id: string) => Promise<Message[]>;
	onJump: (messageId: string, title: string) => void;
}) {
	const [entries, setEntries] = useState<MessageEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const loadRef = useRef(loadMessages);
	loadRef.current = loadMessages;
	const { agents } = useAgents();
	const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		loadRef
			.current(conversationId)
			.then((messages) => {
				if (controller.signal.aborted) {
					return;
				}
				const items: MessageEntry[] = [];
				for (let i = 0; i < messages.length; i++) {
					const msg = messages[i];
					if (msg.role !== "user") {
						continue;
					}
					const text = (msg.content ?? "").trim();
					if (!text) {
						continue;
					}
					// Find the next assistant message after this user message
					let description: string | undefined;
					for (let j = i + 1; j < messages.length; j++) {
						if (messages[j].role === "assistant") {
							const reply = (messages[j].content ?? "").trim();
							if (reply) {
								description =
									reply.length > 160 ? `${reply.slice(0, 160)}…` : reply;
							}
							break;
						}
					}
					items.push({
						id: msg.id,
						title: text.length > 72 ? `${text.slice(0, 72)}…` : text,
						description,
					});
				}
				setEntries(items);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setEntries([]);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			});
		return () => controller.abort();
	}, [conversationId]);

	if (loading) {
		return (
			<p className="flex items-center gap-1.5 py-1 pl-8 text-muted-foreground text-xs">
				<Spinner className="size-3" />
				Loading messages…
			</p>
		);
	}
	if (entries.length === 0) {
		return (
			<p className="py-1 pl-8 text-muted-foreground text-xs">No messages yet</p>
		);
	}
	return (
		<ul className="flex flex-col gap-0.5">
			{entries.map((entry) => (
				<li key={entry.id}>
					<HoverCard>
						<HoverCardTrigger
							className="flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-8 text-left transition-colors hover:bg-muted"
							closeDelay={0}
							delay={0}
							onClick={() => onJump(entry.id, entry.title)}
							type="button"
						>
							{agent ? (
								<AgentAvatar
									avatarUrl={agent.avatarUrl}
									className="size-3 shrink-0 rounded-[2px] object-contain"
									engine={engineForAgent(agent)}
									size="12px"
								/>
							) : (
								<HugeiconsIcon
									className="size-3 shrink-0 text-muted-foreground"
									icon={Message01Icon}
								/>
							)}
							<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
								{entry.title}
							</span>
						</HoverCardTrigger>
						{entry.description ? (
							<HoverCardContent
								align="start"
								className="w-72 max-w-[min(18rem,calc(100vw-2rem))] p-3"
								side="right"
								sideOffset={10}
							>
								<div className="flex flex-col gap-2">
									<p className="font-medium text-sm leading-snug">
										{entry.title}
									</p>
									{agent ? (
										<div className="flex items-start gap-2">
											<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
												<AgentAvatar
													avatarUrl={agent.avatarUrl}
													className="size-5 rounded-full object-cover"
													engine={engineForAgent(agent)}
													size="20px"
												/>
											</span>
											<div className="min-w-0 flex-1">
												<p className="mb-0.5 text-[11px] text-muted-foreground">
													{agent.name}
												</p>
												<p className="line-clamp-4 text-muted-foreground text-xs leading-relaxed">
													{entry.description}
												</p>
											</div>
										</div>
									) : (
										<p className="line-clamp-4 text-muted-foreground text-xs leading-relaxed">
											{entry.description}
										</p>
									)}
								</div>
							</HoverCardContent>
						) : null}
					</HoverCard>
				</li>
			))}
		</ul>
	);
}

/** Nested accordion header used under a chat row (Messages / Side chats). */
export function ChatRowSubAccordion({
	label,
	expanded,
	onToggle,
	children,
	count,
}: {
	label: string;
	expanded: boolean;
	onToggle: () => void;
	children: React.ReactNode;
	count?: number;
}) {
	return (
		<div className="pl-4">
			<button
				aria-expanded={expanded}
				className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onToggle();
				}}
				type="button"
			>
				<HugeiconsIcon
					className={`size-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
					icon={ArrowDown01Icon}
				/>
				<span className="font-medium">{label}</span>
				{typeof count === "number" ? (
					<span className="text-muted-foreground/70 tabular-nums">{count}</span>
				) : null}
			</button>
			{expanded ? children : null}
		</div>
	);
}
