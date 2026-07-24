// apps/desktop/src/components/downloads/DownloadCenter.tsx
//
// App-wide download tray (#456). A 28px icon button in the sidebar footer with
// a badge for active/failed downloads; click it for a panel with three parts:
// promoted "Available updates" (agents/engines/tools/plugins/app on a newer
// version — see AvailableUpdates), the downloads themselves split into Active
// and Finished, and an "Open downloads" action that pops out to the full
// DownloadsPage. Reads the downloads store (fed by the SSE stream) and the
// update aggregate, and drives Core's control endpoints on the active node.
//
// The live aggregate is the header's status line plus one full-bleed activity
// line under it — not a strip of its own. It used to be a third progress bar
// stacked above the per-row bars, which made a two-item download look like a
// loading screen.
//
// Chrome comes from TrayPopover, shared with the Inbox tray so the two footer
// popovers read as the same object.

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Popover, PopoverTrigger } from "@ryu/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	TrayBadge,
	TrayEmpty,
	TrayFooter,
	TrayHeader,
	TrayPopoverContent,
	TrayProgressLine,
	TrayScroll,
	TraySectionLabel,
	TrayTextButton,
	trayMeta,
	trayTriggerClass,
} from "@/src/components/shell/TrayPopover.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useAvailableUpdates } from "@/src/hooks/useAvailableUpdates.ts";
import { useFriendlyMode } from "@/src/hooks/useFriendlyMode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import { clearDownload, isInFlight } from "@/src/lib/api/downloads.ts";
import {
	selectAggregate,
	selectOrderedTasks,
	useDownloadsStore,
} from "@/src/store/useDownloadsStore.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import { AvailableUpdates } from "./AvailableUpdates.tsx";
import { DownloadRow, formatBytes } from "./DownloadRow.tsx";

/**
 * The app-wide download control: a compact icon button (sidebar footer, beside
 * Settings) with a badge for active/failed downloads. Click to open a panel with
 * promoted available updates + every tracked download, and an "Open downloads"
 * action that pops out to the full page. Always rendered so it stays a stable
 * sidebar control; the panel shows an empty state when nothing is tracked.
 */
export function DownloadCenter() {
	// useShallow: both selectors derive a fresh object/array each call; without a
	// shallow equality check Zustand's useSyncExternalStore sees a new snapshot
	// every render ("getSnapshot should be cached") and spins into an infinite
	// update loop.
	const aggregate = useDownloadsStore(useShallow(selectAggregate));
	const tasks = useDownloadsStore(useShallow(selectOrderedTasks));
	// Available updates (newer versions of installed agents/engines/tools/plugins)
	// feed the badge too, so the count shows even when nothing is actively
	// downloading — matching the "Updates" section in the panel body.
	const { updates } = useAvailableUpdates();
	const getNode = useNodeStore((s) => s.getActiveNode);
	const [friendly] = useFriendlyMode();
	const { openTab } = useTabsContext();
	const [open, setOpen] = useState(false);

	const clearFinished = useCallback(() => {
		const target = toTarget(getNode());
		for (const task of tasks) {
			if (task.state === "completed" || task.state === "cancelled") {
				clearDownload(target, task.id).catch(() => undefined);
			}
		}
	}, [getNode, tasks]);

	// Active keeps everything still moving (or paused/failed and therefore
	// actionable) at the top; finished sinks below it.
	const active = tasks.filter(
		(t) => isInFlight(t.state) || t.state === "paused" || t.state === "failed"
	);
	const finished = tasks.filter(
		(t) => t.state === "completed" || t.state === "cancelled"
	);
	const speedBps = tasks.reduce(
		(sum, t) => sum + (isInFlight(t.state) ? (t.speed_bps ?? 0) : 0),
		0
	);
	const isEmpty =
		!aggregate.hasAny && updates.length === 0 && tasks.length === 0;

	// Badge priority: active downloads → failed downloads → available updates.
	// It surfaces the count that most needs attention, so a plain "3 newer
	// versions" still shows when nothing is downloading.
	let badgeCount = updates.length;
	let badgeLabel = "updates available";
	if (aggregate.inFlight > 0) {
		badgeCount = aggregate.inFlight;
		badgeLabel = "downloads in progress";
	} else if (aggregate.failed > 0) {
		badgeCount = aggregate.failed;
		badgeLabel = "failed downloads";
	}
	const badgeFailed = aggregate.inFlight === 0 && aggregate.failed > 0;

	let status: string | undefined;
	if (aggregate.inFlight > 0) {
		status = trayMeta(
			`${aggregate.inFlight} downloading`,
			aggregate.percent === null ? null : `${Math.round(aggregate.percent)}%`,
			speedBps > 0 ? `${formatBytes(speedBps)}/s` : null
		);
	} else if (aggregate.failed > 0) {
		status = `${aggregate.failed} failed`;
	} else if (updates.length > 0) {
		status = `${updates.length} update${updates.length === 1 ? "" : "s"} available`;
	}

	const openFullPage = () => {
		setOpen(false);
		openTab("/downloads");
	};

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger aria-label="Downloads" className={trayTriggerClass}>
							<HugeiconsIcon icon={Download01Icon} size={15} />
							<TrayBadge
								count={badgeCount}
								label={badgeLabel}
								tone={badgeFailed ? "danger" : "primary"}
							/>
						</PopoverTrigger>
					}
				/>
				<TooltipContent>Downloads</TooltipContent>
			</Tooltip>
			<TrayPopoverContent>
				<TrayHeader
					actions={
						finished.length > 0 ? (
							<TrayTextButton onClick={clearFinished}>
								Clear finished
							</TrayTextButton>
						) : undefined
					}
					count={aggregate.inFlight}
					status={status}
					title="Downloads"
				/>
				{aggregate.inFlight > 0 && (
					<TrayProgressLine percent={aggregate.percent} />
				)}
				{isEmpty ? (
					<TrayEmpty
						description="Installs and updates you start show their progress here."
						icon={Download01Icon}
						title="Nothing downloading"
					/>
				) : (
					<TrayScroll>
						<AvailableUpdates compact />
						{active.length > 0 && (
							<>
								<TraySectionLabel count={active.length}>
									Active
								</TraySectionLabel>
								{active.map((task) => (
									<DownloadRow friendly={friendly} key={task.id} task={task} />
								))}
							</>
						)}
						{finished.length > 0 && (
							<>
								<TraySectionLabel count={finished.length}>
									Finished
								</TraySectionLabel>
								{finished.map((task) => (
									<DownloadRow friendly={friendly} key={task.id} task={task} />
								))}
							</>
						)}
					</TrayScroll>
				)}
				<TrayFooter label="Open downloads" onClick={openFullPage} />
			</TrayPopoverContent>
		</Popover>
	);
}
