"use client";

import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import { cn } from "@ryu/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Shared sidebar-row preview: always shows on hover (unlike OverflowTooltip,
 * which only appears when text overflows). Caps width so titles wrap
 * consistently; plugins and built-in rows share this chrome.
 */
export function SidebarItemPreview({
	children,
	content,
	className,
	side = "right",
	sideOffset = 8,
}: {
	children: ReactNode;
	content: ReactNode;
	className?: string;
	side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
	sideOffset?: number;
}) {
	return (
		<HoverCard>
			<HoverCardTrigger className="min-w-0 flex-1">{children}</HoverCardTrigger>
			<HoverCardContent
				align="start"
				className={cn(
					"w-72 max-w-[min(18rem,calc(100vw-2rem))] p-3 text-sm",
					className
				)}
				side={side}
				sideOffset={sideOffset}
			>
				{content}
			</HoverCardContent>
		</HoverCard>
	);
}

/** Title block used by chat / plugin sidebar previews — wraps the full name. */
export function SidebarPreviewTitle({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<p className="wrap-break-word font-medium text-sm leading-snug">
				{title}
			</p>
			{children}
		</div>
	);
}

/** Compact metadata row (branch, worktree, agents, …). */
export function SidebarPreviewMeta({
	label,
	value,
}: {
	label: string;
	value: ReactNode;
}) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	return (
		<div className="flex min-w-0 items-baseline gap-2 text-xs">
			<span className="shrink-0 text-muted-foreground">{label}</span>
			<span className="min-w-0 truncate text-foreground/90">{value}</span>
		</div>
	);
}

/** Past titles for a chat (auto-rename history), oldest → newest. */
export function SidebarPreviewTitleHistory({
	entries,
}: {
	entries: Array<{ source: string; title: string }>;
}) {
	if (entries.length <= 1) {
		return null;
	}
	const prior = entries.slice(0, -1);
	return (
		<div className="flex flex-col gap-1 border-border/60 border-t pt-2">
			<p className="text-[11px] text-muted-foreground uppercase tracking-wide">
				Title history
			</p>
			<ul className="flex flex-col gap-0.5">
				{prior.map((entry, index) => (
					<li
						className="wrap-break-word text-muted-foreground text-xs leading-snug"
						key={`${entry.source}-${index}-${entry.title}`}
					>
						<span className="text-muted-foreground/70">
							{entry.source === "user"
								? "Renamed"
								: entry.source === "auto"
									? "Auto"
									: "First"}
							:{" "}
						</span>
						{entry.title}
					</li>
				))}
			</ul>
		</div>
	);
}
