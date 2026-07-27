"use client";

import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import {
	useMessageScroller,
	useMessageScrollerVisibility,
} from "@ryu/ui/components/message-scroller";
import { cn } from "@ryu/ui/lib/utils";
import { motion } from "motion/react";
import { memo, type ReactNode, useEffect } from "react";

export interface ChatTocFileChange {
	/** Basename or relative path shown in the popover. */
	name: string;
	/** Optional add/remove summary (e.g. "+12 −3"). */
	stats?: string;
}

export interface ChatTocItem {
	/** Agent mark shown beside the reply. */
	agentAvatar?: ReactNode;
	agentName?: string;
	/** Assistant reply excerpt (description). */
	description?: string;
	/** Files touched in this turn; popover shows a short prefix. */
	files?: ChatTocFileChange[];
	id: string;
	/** User message (title). */
	title: string;
}

const lineVariants = {
	normal: { width: 16 },
	active: { width: 28 },
	hover: { width: 28 },
};

const MAX_PREVIEW_FILES = 4;

/**
 * Notion-style table of contents for the chat. Renders one marker per user
 * message down the left gutter of the message list. Collapsed to bare lines by
 * default; hovering a marker opens a preview popover (user prompt, agent reply,
 * files changed). Clicking scrolls that turn into view.
 */
export const ChatToc = memo(function ChatToc({
	items,
	className,
}: {
	items: ChatTocItem[];
	className?: string;
}) {
	const { scrollToMessage } = useMessageScroller();
	const { currentAnchorId } = useMessageScrollerVisibility();

	// Sidebar / deep-link jump: ChatPage dispatches this once messages hydrate.
	useEffect(() => {
		const onJump = (event: Event) => {
			const messageId = (event as CustomEvent<{ messageId?: string }>).detail
				?.messageId;
			if (messageId) {
				scrollToMessage(messageId, { align: "start" });
			}
		};
		window.addEventListener("ryu:scroll-to-message", onJump);
		return () => window.removeEventListener("ryu:scroll-to-message", onJump);
	}, [scrollToMessage]);

	// Nothing worth navigating with a single turn.
	if (items.length < 2) {
		return null;
	}

	return (
		<nav
			aria-label="Message navigation"
			className={cn(
				"group/toc no-scrollbar pointer-events-auto absolute inset-s-2 top-1/2 z-20 hidden max-h-[70%] -translate-y-1/2 flex-col gap-2 overflow-y-auto py-2 lg:flex",
				className
			)}
		>
			{items.map((item) => {
				const isActive = item.id === currentAnchorId;
				const extraFiles = (item.files?.length ?? 0) - MAX_PREVIEW_FILES;

				return (
					<HoverCard key={item.id}>
						<HoverCardTrigger
							aria-current={isActive ? "true" : undefined}
							className="group/toc-item relative flex h-4 cursor-pointer items-center gap-2 text-left"
							onClick={() => scrollToMessage(item.id, { align: "start" })}
						>
							<motion.span
								animate={isActive ? "active" : "normal"}
								className="block h-px shrink-0 rounded-full bg-foreground/25 transition-colors group-hover/toc-item:bg-foreground group-hover/toc:bg-foreground/40 group-aria-[current=true]/toc-item:bg-foreground"
								initial={false}
								transition={{ type: "spring", stiffness: 200, damping: 20 }}
								variants={lineVariants}
								whileHover="hover"
							/>
							<span className="max-w-[220px] truncate whitespace-nowrap text-muted-foreground text-xs opacity-0 transition-opacity duration-200 group-hover/toc-item:text-foreground group-hover/toc:opacity-100 group-aria-[current=true]/toc-item:text-foreground">
								{item.title}
							</span>
						</HoverCardTrigger>
						<HoverCardContent
							align="start"
							className="w-72 max-w-[min(18rem,calc(100vw-2rem))] p-3"
							side="right"
							sideOffset={10}
						>
							<div className="flex flex-col gap-2">
								<p className="font-medium text-sm leading-snug">{item.title}</p>
								{(item.description || item.agentAvatar) && (
									<div className="flex items-start gap-2">
										{item.agentAvatar ? (
											<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
												{item.agentAvatar}
											</span>
										) : null}
										<div className="min-w-0 flex-1">
											{item.agentName ? (
												<p className="mb-0.5 text-[11px] text-muted-foreground">
													{item.agentName}
												</p>
											) : null}
											{item.description ? (
												<p className="line-clamp-4 text-muted-foreground text-xs leading-relaxed">
													{item.description}
												</p>
											) : null}
										</div>
									</div>
								)}
								{item.files && item.files.length > 0 ? (
									<div className="border-border/60 border-t pt-2">
										<p className="mb-1.5 text-[11px] text-muted-foreground">
											Files changed
										</p>
										<ul className="flex flex-col gap-1">
											{item.files.slice(0, MAX_PREVIEW_FILES).map((file) => (
												<li
													className="flex min-w-0 items-baseline justify-between gap-2 text-xs"
													key={file.name}
												>
													<span className="min-w-0 truncate font-mono text-[11px]">
														{file.name}
													</span>
													{file.stats ? (
														<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
															{file.stats}
														</span>
													) : null}
												</li>
											))}
										</ul>
										{extraFiles > 0 ? (
											<p className="mt-1 text-[10px] text-muted-foreground">
												+{extraFiles} more
											</p>
										) : null}
									</div>
								) : null}
							</div>
						</HoverCardContent>
					</HoverCard>
				);
			})}
		</nav>
	);
});
