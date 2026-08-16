/* @jsxImportSource @opentui/react */
// Tasks surface (path /tasks) - mirrors the desktop Tasks/Quests page as a to-do
// oriented view of the work Ryu runs on your behalf.
//
// The screen PREFERS a contributed declarative view: an enabled plugin contributing
// a `views` entry with id "surface:tasks" claims this surface, and the shell renders
// that spec (src/ui/ContributedView.tsx) instead of the built-in list below. Until
// then the hand-written screen stays.
//
// The terminal folds the legacy
// schedules tab (src/tabs/schedules.tsx) in: the scheduled (heartbeat) jobs from
// GET /heartbeat/jobs, each row showing enabled state, name, cadence, last outcome
// and last-run date. Read-only (the terminal never mutates jobs here). Keys are
// gated on being the focused pane's active tab: ↑↓/jk navigate, r refreshes.

import { useKeyboard } from "@opentui/react";
import { fetchJobs, type ScheduledJob } from "@ryuhq/core-client/schedules";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card.tsx";
import { useTheme } from "@/components/ui/theme-provider.tsx";
import { useSurfaceView } from "../../core/ContributionsContext.tsx";
import { useCore } from "../../core/CoreContext.tsx";
import { ContributedViewPanel } from "../../ui/ContributedView.tsx";
import { ErrorView } from "../../ui/ErrorView.tsx";
import { Loading } from "../../ui/Loading.tsx";
import type { SurfaceModule, SurfaceProps } from "../../workspace/router.ts";
import { useWorkspace } from "../../workspace/WorkspaceContext.tsx";

const NAME_WIDTH = 20;
const SCHEDULE_WIDTH = 22;
const VISIBLE_ROWS = 16;

// The surface id — and therefore the `views` id an app declares to claim this
// screen, as the reserved `surface:<id>` token (see viewClaimingSurface in
// src/core/contributions.ts).
const SURFACE_ID = "tasks";

function scheduleLabel(job: ScheduledJob): string {
	const { schedule } = job;
	if (schedule.kind === "cron") {
		return schedule.expr.length > 0 ? schedule.expr : "—";
	}
	return schedule.interval.length > 0 ? `every ${schedule.interval}` : "—";
}

function lastRunLabel(job: ScheduledJob): string {
	if (!job.lastRunAt) {
		return "—";
	}
	const [date] = job.lastRunAt.split("T");
	return date && date.length > 0 ? date : "—";
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value.padEnd(width, " ");
}

function TasksSurface({ active, paneId }: SurfaceProps) {
	const { target, url, token } = useCore();
	const theme = useTheme();
	const { focusedPaneId } = useWorkspace();
	const focused = active && focusedPaneId === paneId;
	const contributed = useSurfaceView(SURFACE_ID);

	const [jobs, setJobs] = useState<ScheduledJob[]>([]);
	const [index, setIndex] = useState(0);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Track the latest request so a stale resolve cannot clobber fresh data.
	const reqRef = useRef(0);

	const runLoad = useCallback(() => {
		const reqId = ++reqRef.current;
		setLoading(true);
		setError(null);
		fetchJobs(target)
			.then((next) => {
				if (reqRef.current !== reqId) {
					return;
				}
				setJobs(next);
				setIndex((i) => (next.length === 0 ? 0 : Math.min(i, next.length - 1)));
				setLoaded(true);
			})
			.catch((err: unknown) => {
				if (reqRef.current !== reqId) {
					return;
				}
				setError(err instanceof Error ? err.message : String(err));
				setLoaded(true);
			})
			.finally(() => {
				if (reqRef.current === reqId) {
					setLoading(false);
				}
			});
	}, [target]);

	// Lazy load on activation, and reload on node switch (url/token). Skipped while
	// a contributed view owns the screen — the built-in list is not rendered then,
	// so fetching its data would be pure waste.
	useEffect(() => {
		if (active && !contributed) {
			runLoad();
		}
	}, [active, contributed, runLoad]);

	useKeyboard((key) => {
		if (!focused || contributed) {
			return;
		}
		if (key.name === "up" || key.name === "k") {
			setIndex((i) => Math.max(0, i - 1));
		} else if (key.name === "down" || key.name === "j") {
			setIndex((i) => Math.min(Math.max(0, jobs.length - 1), i + 1));
		} else if (key.name === "r") {
			runLoad();
		}
	});

	const header = (
		<box flexDirection="row" gap={2} paddingBottom={1} paddingLeft={1}>
			<text fg={theme.colors.foreground}>
				<b>Tasks</b>
			</text>
			<text fg={theme.colors.mutedForeground}>
				{contributed ? "" : "scheduled jobs · ↑↓ nav · r refresh"}
			</text>
		</box>
	);

	// An app claimed this surface: render its declarative view in place of the
	// built-in list, keeping the page frame so the shell still looks like itself.
	if (contributed) {
		return (
			<box flexDirection="column" flexGrow={1} paddingTop={1}>
				{header}
				<box flexDirection="column" paddingLeft={1}>
					<ContributedViewPanel focused={focused} view={contributed} />
				</box>
			</box>
		);
	}

	if (loading && !loaded) {
		return (
			<box flexDirection="column" flexGrow={1} paddingTop={1}>
				{header}
				<Loading label="Loading scheduled jobs…" />
			</box>
		);
	}

	if (error) {
		return (
			<box flexDirection="column" flexGrow={1} paddingTop={1}>
				{header}
				<ErrorView message={error} />
			</box>
		);
	}

	if (jobs.length === 0) {
		return (
			<box flexDirection="column" flexGrow={1} paddingTop={1}>
				{header}
				<box paddingLeft={1}>
					<Card title="scheduled jobs">
						<text fg={theme.colors.mutedForeground}>
							no scheduled jobs — press r to refresh
						</text>
					</Card>
				</box>
			</box>
		);
	}

	const selected = Math.min(index, jobs.length - 1);
	// Window the rows so the selection stays visible without a focus-capturing
	// scrollbox (which would fight the keyboard handler for arrow keys).
	const start = Math.max(
		0,
		Math.min(
			selected - Math.floor(VISIBLE_ROWS / 2),
			Math.max(0, jobs.length - VISIBLE_ROWS)
		)
	);
	const visible = jobs.slice(start, start + VISIBLE_ROWS);

	return (
		<box flexDirection="column" flexGrow={1} paddingTop={1}>
			{header}
			<box paddingLeft={1}>
				<Card title="scheduled jobs">
					{visible.map((job, i) => (
						<JobRow job={job} key={job.id} selected={start + i === selected} />
					))}
					{jobs.length > visible.length ? (
						<text fg={theme.colors.mutedForeground}>
							{`${selected + 1}/${jobs.length}`}
						</text>
					) : null}
				</Card>
			</box>
		</box>
	);
}

function JobRow({ job, selected }: { job: ScheduledJob; selected: boolean }) {
	const theme = useTheme();
	const enabledIcon = job.enabled ? "●" : "○";
	const enabledColor = job.enabled
		? theme.colors.success
		: theme.colors.mutedForeground;
	let outcomeIcon = "—";
	let outcomeColor = theme.colors.mutedForeground;
	if (job.lastOutcome === "success") {
		outcomeIcon = "✓";
		outcomeColor = theme.colors.success;
	} else if (job.lastOutcome === "failure") {
		outcomeIcon = "✗";
		outcomeColor = theme.colors.error;
	}
	const nameColor = selected ? theme.colors.primary : theme.colors.foreground;
	return (
		<box flexDirection="row" gap={1}>
			<text fg={selected ? theme.colors.primary : theme.colors.muted}>
				{selected ? "›" : " "}
			</text>
			<text fg={enabledColor}>{enabledIcon}</text>
			<text fg={nameColor}>
				{selected ? (
					<b>{pad(job.name, NAME_WIDTH)}</b>
				) : (
					pad(job.name, NAME_WIDTH)
				)}
			</text>
			<text fg={theme.colors.mutedForeground}>
				{pad(scheduleLabel(job), SCHEDULE_WIDTH)}
			</text>
			<text fg={outcomeColor}>{outcomeIcon}</text>
			<text fg={theme.colors.mutedForeground}>{lastRunLabel(job)}</text>
		</box>
	);
}

/** The Tasks surface module (path /tasks). Registered by the Integrate step. */
export const tasksSurface: SurfaceModule = {
	id: SURFACE_ID,
	title: "Tasks",
	match: (path) => path === "/tasks" || path.startsWith("/tasks/"),
	Component: TasksSurface,
};
