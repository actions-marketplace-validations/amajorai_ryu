"use client";

import { ArrowDown01Icon, Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Spinner } from "@ryu/ui/components/spinner";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/types/chat.ts";

/**
 * Lazily-loaded list of user turns for a conversation, shown indented under
 * its sidebar row. Clicking a turn opens the chat and scrolls to that message.
 */
export function SidebarChatMessages({
	conversationId,
	loadMessages,
	onJump,
}: {
	conversationId: string;
	loadMessages: (id: string) => Promise<Message[]>;
	onJump: (messageId: string, title: string) => void;
}) {
	const [entries, setEntries] = useState<{ id: string; title: string }[]>([]);
	const [loading, setLoading] = useState(true);
	const loadRef = useRef(loadMessages);
	loadRef.current = loadMessages;

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		loadRef
			.current(conversationId)
			.then((messages) => {
				if (controller.signal.aborted) {
					return;
				}
				const items: { id: string; title: string }[] = [];
				for (const msg of messages) {
					if (msg.role !== "user") {
						continue;
					}
					const text = (msg.content ?? "").trim();
					if (!text) {
						continue;
					}
					items.push({
						id: msg.id,
						title: text.length > 72 ? `${text.slice(0, 72)}…` : text,
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
					<button
						className="flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-8 text-left transition-colors hover:bg-muted"
						onClick={() => onJump(entry.id, entry.title)}
						type="button"
					>
						<HugeiconsIcon
							className="size-3 shrink-0 text-muted-foreground"
							icon={Message01Icon}
						/>
						<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
							{entry.title}
						</span>
					</button>
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
