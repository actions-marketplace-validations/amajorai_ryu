import { useEffect, useRef, useState } from "react";

/**
 * Per-tool-call timing, the row-level counterpart to the whole-turn duration in
 * `message-stats.tsx`.
 *
 * # Where the start time comes from
 *
 * Nothing upstream timestamps a tool call. The AI SDK part carries a `state`
 * (`input-available` -> `output-available`) but no clock, and Core's stream does
 * not stamp one either, so there is no authoritative start to read. What IS
 * reliable is that a tool row mounts when its call first appears in the stream
 * and stays mounted, so the row's own mount is the start — measured here rather
 * than threaded down through every renderer.
 *
 * The consequence, stated because it is a real limit rather than a rounding
 * error: reopening a persisted conversation re-mounts finished rows, which would
 * otherwise restart their clocks and display a running timer on a call that
 * completed days ago. `isRunning` starting false is what prevents that — a row
 * that mounts already-complete never starts a clock and renders nothing, so
 * historical calls show no timing at all instead of a fabricated one. Timing
 * appears on calls this client actually watched run.
 */

const TICK_MS = 100;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
/** Below this, whole seconds round most calls to a useless "0s". */
const SUB_SECOND_CUTOFF_MS = 1000;
const TEN_SECONDS_MS = 10_000;

/**
 * Format a tool-call duration.
 *
 * Deliberately finer-grained than `formatDuration` in `message-stats.tsx`, which
 * rounds to whole seconds: that is right for a turn lasting minutes and wrong
 * here, where a great many tool calls finish in under a second and would all
 * render as "0s". Precision tapers as the number grows, so the column stays
 * narrow: "420ms", "3.2s", "12s", "1m 23s".
 */
export function formatToolDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return "";
	}
	if (ms < SUB_SECOND_CUTOFF_MS) {
		return `${Math.round(ms)}ms`;
	}
	if (ms < TEN_SECONDS_MS) {
		return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
	}
	const totalSeconds = Math.round(ms / MS_PER_SECOND);
	if (totalSeconds < SECONDS_PER_MINUTE) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	return `${minutes}m ${seconds}s`;
}

/**
 * Elapsed milliseconds for one tool call, live while it runs and frozen once it
 * finishes. Returns null when there is nothing honest to show — either the call
 * was already complete on mount (see the note above), or it never ran.
 */
export function useToolElapsed(isRunning: boolean): number | null {
	const startedAtRef = useRef<number | null>(null);
	const [elapsedMs, setElapsedMs] = useState<number | null>(null);

	useEffect(() => {
		if (!isRunning) {
			// Freeze on the last tick. Without a recorded start this is a row that
			// mounted already-finished, so it stays null and renders nothing.
			return;
		}
		if (startedAtRef.current === null) {
			startedAtRef.current = Date.now();
		}
		const started = startedAtRef.current;
		setElapsedMs(Date.now() - started);
		const id = setInterval(() => setElapsedMs(Date.now() - started), TICK_MS);
		return () => clearInterval(id);
	}, [isRunning]);

	return elapsedMs;
}

/**
 * The timing badge itself. Muted and tabular so a ticking counter does not
 * shift the row's layout on every frame.
 */
export function ToolTiming({
	isRunning,
	className,
}: {
	className?: string;
	isRunning: boolean;
}) {
	const elapsedMs = useToolElapsed(isRunning);
	if (elapsedMs === null) {
		return null;
	}
	const label = formatToolDuration(elapsedMs);
	if (!label) {
		return null;
	}
	return (
		<span
			// Running calls announce themselves; a frozen final time does not need to
			// interrupt a screen reader mid-turn.
			aria-live={isRunning ? "off" : undefined}
			className={
				className ??
				"shrink-0 whitespace-nowrap font-normal text-muted-foreground/60 text-xs tabular-nums"
			}
			title={isRunning ? "Running" : "Time taken"}
		>
			{label}
		</span>
	);
}
