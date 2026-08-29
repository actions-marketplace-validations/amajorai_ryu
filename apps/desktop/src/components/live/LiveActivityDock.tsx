// apps/desktop/src/components/live/LiveActivityDock.tsx
//
// The desktop "Dynamic Island" — a compact pill dock of live activities rendered
// on the EMPTY SHELL page (when no tabs are open). It mirrors the iOS/macOS Live
// Activities mental model: each activity is a small pill (app glyph + status
// pulse + title), and interacting with it expands it into a detail card (title,
// detail line, determinate progress bar, open-action) with a layout spring.
//
// Self-hides entirely when nothing is live, so the no-tabs launchpad stays calm
// when there is nothing to report. Rendered by `EmptyTabsState`; reads the shared
// live-activity store fed by the built-in + contributed adapters.

import type { LiveActivity } from "@ryu/app-host/live-activity";
import { Icon } from "@ryu/ui/components/icon";
import { SPRING_MORPH } from "@ryu/ui/lib/ease";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useLiveActivities } from "@/src/store/useLiveActivityStore.ts";

/** Status → pulse/tone colour, matching the island's status-dot language. */
const STATUS_TONE: Record<LiveActivity["status"], string> = {
	running: "var(--primary)",
	waiting: "var(--warning, #f59e0b)",
	review: "var(--warning, #f59e0b)",
	done: "var(--success, #22c55e)",
	error: "var(--destructive)",
};

function statusLabel(status: LiveActivity["status"]): string {
	switch (status) {
		case "running":
			return "Running";
		case "waiting":
			return "Needs input";
		case "review":
			return "In review";
		case "done":
			return "Done";
		case "error":
			return "Failed";
	}
}

/** Activate a card's action (route open; a view target would route the same). */
function useActivate() {
	const { openTab } = useTabsContext();
	return (activity: LiveActivity) => {
		if (activity.action?.kind === "route") {
			openTab(activity.action.path, { title: activity.title });
		}
	};
}

/** One expanded detail card. */
function ActivityCard({
	activity,
	onOpen,
}: {
	activity: LiveActivity;
	onOpen: (a: LiveActivity) => void;
}) {
	const tone = STATUS_TONE[activity.status] ?? "var(--primary)";
	return (
		<motion.div
			className="flex w-64 flex-col gap-2 rounded-2xl border border-border/70 bg-popover/95 p-3 text-left shadow-lg backdrop-blur-md"
			layout
			transition={SPRING_MORPH}
		>
			<div className="flex items-start gap-2.5">
				<span
					aria-hidden
					className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md"
					style={{
						backgroundColor: `color-mix(in srgb, ${tone} 15%, transparent)`,
					}}
				>
					<Icon className="size-3.5" icon={activity.icon ?? "activity-03"} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate font-medium text-foreground text-xs">
							{activity.title}
						</span>
						<span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground uppercase tracking-wide">
							{statusLabel(activity.status)}
						</span>
					</div>
					<p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground leading-snug">
						{activity.detail}
					</p>
				</div>
			</div>
			{activity.progress !== undefined && (
				<div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
					<motion.div
						animate={{ width: `${Math.round(activity.progress * 100)}%` }}
						className="h-full rounded-full"
						style={{ backgroundColor: tone }}
						transition={{ duration: 0.4, ease: "easeOut" }}
					/>
				</div>
			)}
			{activity.action && (
				<button
					className="mt-1 flex items-center justify-center gap-1 rounded-lg bg-muted/70 py-1.5 font-medium text-[11px] text-foreground transition-colors hover:bg-muted"
					onClick={() => onOpen(activity)}
					type="button"
				>
					Open
				</button>
			)}
		</motion.div>
	);
}

/** One compact pill — the collapsed "island" state. */
function ActivityPill({
	activity,
	expanded,
	onToggle,
	onOpen,
}: {
	activity: LiveActivity;
	expanded: boolean;
	onOpen: (a: LiveActivity) => void;
	onToggle: (a: LiveActivity) => void;
}) {
	const tone = STATUS_TONE[activity.status] ?? "var(--primary)";
	return (
		<motion.button
			aria-expanded={expanded}
			className="group flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-popover/90 px-3 shadow-sm backdrop-blur-md transition-colors hover:bg-popover"
			layout
			onClick={() => onToggle(activity)}
			type="button"
		>
			<span
				aria-hidden
				className="relative flex size-4 items-center justify-center"
			>
				<span
					className="absolute size-1.5 rounded-full"
					style={{ backgroundColor: tone }}
				/>
				{activity.status === "running" && (
					<span
						aria-hidden
						className="absolute size-1.5 animate-ping rounded-full"
						style={{ backgroundColor: tone, opacity: 0.6 }}
					/>
				)}
			</span>
			<span className="max-w-28 truncate font-medium text-foreground text-xs">
				{activity.title}
			</span>
			{activity.progress !== undefined && (
				<span className="text-[10px] text-muted-foreground tabular-nums">
					{Math.round(activity.progress * 100)}%
				</span>
			)}
			{expanded && (
				<span
					aria-hidden
					className="ml-0.5 rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground"
				>
					{statusLabel(activity.status)}
				</span>
			)}
			{activity.action && (
				<span
					aria-hidden
					className="ml-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
					onClick={(e) => {
						e.stopPropagation();
						onOpen(activity);
					}}
				>
					<Icon className="size-3" icon="arrow-up-right-01" />
				</span>
			)}
		</motion.button>
	);
}

/**
 * The empty-shell live-activity dock. Collapsed: a row of pills (one per live
 * activity). Expanded: the clicked pill grows into its detail card beside the
 * remaining pills, Dynamic-Island-style. Self-hides when nothing is live.
 */
export function LiveActivityDock() {
	const activities = useLiveActivities();
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const reduceMotion = useReducedMotion();
	const onOpen = useActivate();

	if (activities.length === 0) {
		return null;
	}

	const toggle = (activity: LiveActivity) => {
		setExpandedId((current) => (current === activity.id ? null : activity.id));
	};

	return (
		<motion.div
			className="flex flex-wrap items-center justify-center gap-2"
			layout={!reduceMotion}
		>
			{activities.map((activity) => {
				const expanded = expandedId === activity.id;
				return expanded ? (
					<ActivityCard
						activity={activity}
						key={activity.id}
						onOpen={(a) => {
							onOpen(a);
							setExpandedId(null);
						}}
					/>
				) : (
					<ActivityPill
						activity={activity}
						expanded={false}
						key={activity.id}
						onOpen={(a) => {
							onOpen(a);
							setExpandedId(null);
						}}
						onToggle={toggle}
					/>
				);
			})}
		</motion.div>
	);
}
