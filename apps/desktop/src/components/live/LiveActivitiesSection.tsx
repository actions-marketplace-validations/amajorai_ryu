// apps/desktop/src/components/live/LiveActivitiesSection.tsx
//
// The sidebar's "Live" section — a pinned, self-hiding block of live-activity
// cards (agent working, downloads, approvals, recording, contributed). Rendered
// in the docked sidebar just above the announcements block, so ongoing work is
// visible without opening a tab. Mirrors the `AnnouncementsSection` precedent:
// accent-coloured compact cards, hidden entirely when nothing is live.

import type { LiveActivity } from "@ryu/app-host/live-activity";
import { Icon } from "@ryu/ui/components/icon";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useLiveActivities } from "@/src/store/useLiveActivityStore.ts";

/** Status → tone colour, matching the island's status-dot language. */
const STATUS_TONE: Record<LiveActivity["status"], string> = {
	running: "var(--primary)",
	waiting: "var(--warning, #f59e0b)",
	review: "var(--warning, #f59e0b)",
	done: "var(--success, #22c55e)",
	error: "var(--destructive)",
};

/** A compact row: glyph tile + title/detail + optional progress bar. */
function LiveActivityRow({
	activity,
	onOpen,
}: {
	activity: LiveActivity;
	onOpen: (a: LiveActivity) => void;
}) {
	const tone = STATUS_TONE[activity.status] ?? "var(--primary)";
	const clickable = Boolean(activity.action);
	const row = (
		<div className="flex min-w-0 flex-1 items-start gap-2">
			<span
				aria-hidden
				className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md"
				style={{ backgroundColor: `color-mix(in srgb, ${tone} 15%, transparent)` }}
			>
				<Icon className="size-3.5" icon={activity.icon ?? "activity-03"} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate text-xs font-medium text-foreground">
						{activity.title}
					</span>
					<span
						aria-hidden
						className={`size-1.5 shrink-0 rounded-full ${activity.status === "running" ? "animate-pulse" : ""}`}
						style={{ backgroundColor: tone }}
					/>
				</div>
				{activity.detail && (
					<p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
						{activity.detail}
					</p>
				)}
				{activity.progress !== undefined && (
					<div aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full transition-[width] duration-300"
							style={{
								backgroundColor: tone,
								width: `${Math.round(activity.progress * 100)}%`,
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
	if (!clickable) {
		return (
			<div className="group/act relative flex gap-2.5 rounded-lg border border-border/60 border-l-2 bg-muted/40 p-2.5">
				{row}
			</div>
		);
	}
	return (
		<button
			className="group/act relative flex w-full gap-2.5 rounded-lg border border-border/60 border-l-2 bg-muted/40 p-2.5 text-left transition-colors hover:bg-muted/70"
			onClick={() => onOpen(activity)}
			style={{ borderLeftColor: tone }}
			type="button"
		>
			{row}
			<Icon
				className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/act:opacity-100"
				icon="arrow-up-right-01"
			/>
		</button>
	);
}

/** Pinned "Live" block for the sidebar. Self-hides when nothing is live. */
export function LiveActivitiesSection() {
	const activities = useLiveActivities();
	const { openTab } = useTabsContext();

	if (activities.length === 0) {
		return null;
	}

	const onOpen = (activity: LiveActivity) => {
		if (activity.action?.kind === "route") {
			openTab(activity.action.path, { title: activity.title });
		}
	};

	return (
		<div className="flex flex-col gap-1.5 px-2 pb-1">
			<div className="flex items-center gap-2 px-1">
				<span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
					Live
				</span>
				<div className="flex-1" />
				<span
					aria-hidden
					className="size-1.5 animate-pulse rounded-full bg-primary"
				/>
			</div>
			<div className="scroll-fade flex max-h-[38vh] flex-col gap-1.5 overflow-y-auto">
				{activities.map((activity) => (
					<LiveActivityRow
						activity={activity}
						key={activity.id}
						onOpen={onOpen}
					/>
				))}
			</div>
		</div>
	);
}
