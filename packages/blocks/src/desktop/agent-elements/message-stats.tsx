import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@ryu/ui/components/hover-card";
import { NumberTicker } from "@ryu/ui/components/number-ticker";
import { formatCount, formatCurrency } from "@ryu/ui/lib/number-format.ts";
import { cn } from "@ryu/ui/lib/utils";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAcpElapsedMs } from "./acp-elapsed.ts";
import { ContextRing } from "./context-usage.tsx";

/**
 * Per-message inference statistics streamed by Core as a `data-ryu-stats`
 * part (see `build_stats_part` in `apps/core/src/sidecar/adapters/mod.rs`).
 * Mirrors Jan AI's persisted shape: the engine's own token speed when
 * available, with token counts and timing context.
 */
interface RyuStats {
	/** Prompt tokens served from the provider's cache (`cached_tokens`). */
	cachedTokens?: number;
	completionTokens: number;
	durationMs?: number;
	promptPerSecond?: number;
	promptTokens?: number;
	/** Reasoning tokens billed as completion (`reasoning_tokens`). */
	reasoningTokens?: number;
	tokensPerSecond: number;
	totalTokens?: number;
	ttftMs?: number;
}

const STATS_PART_TYPE = "data-ryu-stats";

function extractStats(msg: UIMessage): RyuStats | null {
	const parts = (msg.parts ?? []) as Array<{ type?: string; data?: unknown }>;
	for (const part of parts) {
		if (part?.type === STATS_PART_TYPE && part.data) {
			const data = part.data as Partial<RyuStats>;
			if (typeof data.tokensPerSecond === "number") {
				return data as RyuStats;
			}
		}
	}
	return null;
}

function StatRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono tabular-nums">{value}</span>
		</div>
	);
}

/**
 * Footer shown under a completed assistant turn: generation speed plus, when
 * the model's context size is known, a context-usage ring. Hovering reveals a
 * breakdown of token counts and timings.
 */
export function MessageStats({
	msg,
	contextSize,
	className,
}: {
	msg: UIMessage;
	/** The active model's context window, used as the ring denominator. */
	contextSize?: number;
	className?: string;
}) {
	const stats = useMemo(() => extractStats(msg), [msg]);
	if (!stats) {
		return null;
	}

	const speed = Math.round(stats.tokensPerSecond);
	const used = stats.totalTokens;
	const hasRing =
		typeof contextSize === "number" &&
		contextSize > 0 &&
		typeof used === "number";
	const pct = hasRing ? (used / contextSize) * 100 : 0;
	const remaining = hasRing ? Math.max(0, contextSize - used) : 0;

	// Base UI carries the open/close delays on the TRIGGER (`delay`), not on the
	// root — where they sat as unknown props that were silently dropped, so the
	// card actually used the 600ms/300ms defaults.
	return (
		<HoverCard>
			<HoverCardTrigger
				className={cn(
					"flex w-fit cursor-default select-none items-center gap-1.5 text-muted-foreground",
					className
				)}
				closeDelay={80}
				delay={120}
			>
				{hasRing ? <ContextRing pct={pct} /> : null}
				<span className="tabular-nums">{speed} tok/s</span>
			</HoverCardTrigger>
			<HoverCardContent className="w-60 text-xs">
				<div className="flex flex-col gap-1.5">
					<StatRow
						label="Generation"
						value={`${stats.tokensPerSecond.toFixed(2)} tok/s`}
					/>
					{typeof stats.promptPerSecond === "number" ? (
						<StatRow
							label="Reading"
							value={`${stats.promptPerSecond.toFixed(2)} tok/s`}
						/>
					) : null}
					<StatRow
						label="Completion"
						value={`${stats.completionTokens} tokens`}
					/>
					{typeof stats.promptTokens === "number" ? (
						<StatRow label="Prompt" value={`${stats.promptTokens} tokens`} />
					) : null}
					{/* Already on the wire from `build_stats_part` — the interface
					    simply never declared them, so the card threw them away. */}
					{typeof stats.cachedTokens === "number" ? (
						<StatRow label="Cached" value={`${stats.cachedTokens} tokens`} />
					) : null}
					{typeof stats.reasoningTokens === "number" ? (
						<StatRow
							label="Reasoning"
							value={`${stats.reasoningTokens} tokens`}
						/>
					) : null}
					{typeof stats.ttftMs === "number" ? (
						<StatRow label="First token" value={`${stats.ttftMs} ms`} />
					) : null}
					{hasRing ? (
						<>
							<div className="my-0.5 h-px bg-border" />
							<StatRow
								label="Context"
								value={`${used} / ${contextSize} (${Math.round(pct)}%)`}
							/>
							<StatRow label="Remaining" value={`${remaining} tokens`} />
						</>
					) : null}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

/**
 * Live inference stats streamed by Core for ACP agents as a `data-acp-usage`
 * part. Unlike the local-engine `data-ryu-stats` part (finalized once), Core
 * emits repeated frames sharing `"id":"acp-usage"` so the AI SDK reconciles
 * them in place: token counts tick up during the turn, and the FINAL frame
 * sets `done:true` with the finalized duration + tokens/sec. See
 * `apps/core/src/sidecar/adapters/mod.rs` (`ui_data`).
 */
interface AcpUsage {
	/** Prompt tokens served from cache this turn (ACP `cachedReadTokens`). */
	cachedReadTokens?: number;
	/** Prompt tokens written to cache this turn (ACP `cachedWriteTokens`). */
	cachedWriteTokens?: number;
	completionTokens?: number;
	/** True on the finalized frame; false/absent while still streaming. */
	done?: boolean;
	durationMs?: number;
	id?: string;
	promptTokens?: number;
	/**
	 * Cumulative spend for the whole ACP SESSION, not this turn — the protocol
	 * only reports it that way (`UsageUpdate.cost`), so it is labelled as such.
	 */
	sessionCostAmount?: number;
	sessionCostCurrency?: string;
	/** Cumulative token total for the session (the per-turn keys are deltas). */
	sessionTotalTokens?: number;
	/** Reasoning tokens this turn (ACP `thoughtTokens`). */
	thoughtTokens?: number;
	tokensPerSecond?: number;
	/** The model's context window, ring denominator. */
	total?: number;
	totalTokens?: number;
	/**
	 * Time from the turn starting to the agent's first visible output (reply text
	 * OR a reasoning chunk). Labelled "First response", not "First token": on a
	 * session's first turn it includes process spawn and `session/new`, so it is
	 * NOT comparable to the local engine's `ttftMs`.
	 */
	ttftMs?: number;
	/** Context tokens used (conversation), for the optional usage ring. */
	used?: number;
}

const ACP_USAGE_PART_TYPE = "data-acp-usage";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

function extractAcpUsage(msg: UIMessage): AcpUsage | null {
	const part = (msg.parts ?? []).find(
		(p) => (p as { type?: string })?.type === ACP_USAGE_PART_TYPE
	) as { type?: string; data?: AcpUsage } | undefined;
	return part?.data ?? null;
}

/** Format a millisecond duration as "12s" (<60s) or "1m 23s" (>=60s). */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) {
		return "0s";
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
 * Best-effort total-token count across the fields Core may populate — `null`
 * when the agent reported none of them.
 *
 * `null`, never 0: ACP's token usage is an UNSTABLE optional capability that
 * most agents do not implement, and the old `?? 0` tail meant every one of those
 * turns rendered a confident, wrong "0 tokens". Absence is not zero, and the
 * caller suppresses the segment instead.
 */
function usageTokenCount(usage: AcpUsage): number | null {
	if (typeof usage.totalTokens === "number") {
		return usage.totalTokens;
	}
	if (typeof usage.completionTokens === "number") {
		return (usage.promptTokens ?? 0) + usage.completionTokens;
	}
	// `used` is NOT this turn's spend — it is context-window occupancy for the
	// whole session (ACP `UsageUpdate.used`, and the cumulative total on the final
	// frame). It is a fine LIVE ticker (it moves while the agent works, and it is
	// the only signal most agents give), but publishing it as the finished turn's
	// token count reprints the whole session's tokens under every reply and grows
	// monotonically — the same inflation the per-turn delta exists to kill.
	if (usage.done) {
		return null;
	}
	return usage.used ?? null;
}

/**
 * Hover-card rows for an ACP turn, mirroring the local-engine card.
 *
 * Every row is emitted ONLY when Core actually carried the field. ACP's usage
 * capability is unstable and optional, support differs per agent AND per agent
 * version, so per-field degradation is the design — an omitted row is correct,
 * a zero-valued row is a lie.
 */
function acpBreakdownRows(usage: AcpUsage): Array<{
	label: string;
	value: string;
}> {
	const rows: Array<{ label: string; value: string }> = [];
	const push = (label: string, value: number | undefined, unit: string) => {
		if (typeof value === "number") {
			rows.push({ label, value: `${formatCount(value) ?? "—"} ${unit}` });
		}
	};
	if (typeof usage.tokensPerSecond === "number" && usage.tokensPerSecond > 0) {
		rows.push({
			label: "Generation",
			value: `${usage.tokensPerSecond.toFixed(2)} tok/s`,
		});
	}
	push("Completion", usage.completionTokens, "tokens");
	push("Prompt", usage.promptTokens, "tokens");
	push("Reasoning", usage.thoughtTokens, "tokens");
	push("Cache read", usage.cachedReadTokens, "tokens");
	push("Cache write", usage.cachedWriteTokens, "tokens");
	// Deliberately NOT "First token": on a session's first turn this includes the
	// agent process spawning and `session/new`, so it is not the local engine's
	// metric under the same name.
	push("First response", usage.ttftMs, "ms");
	if (typeof usage.durationMs === "number" && usage.done) {
		// Whole-turn wall clock — it spans tool calls, MCP round-trips and any
		// approval the user sat on. Labelled "Turn" so it is not read as the
		// model's generation window.
		rows.push({ label: "Turn", value: formatDuration(usage.durationMs) });
	}
	push("Session total", usage.sessionTotalTokens, "tokens");
	if (
		typeof usage.sessionCostAmount === "number" &&
		usage.sessionCostCurrency
	) {
		rows.push({
			label: "Session cost",
			value: formatCurrency(
				usage.sessionCostAmount,
				usage.sessionCostCurrency,
				{
					maximumFractionDigits: 4,
					minimumFractionDigits: 2,
				}
			),
		});
	}
	return rows;
}

/**
 * Footer for ACP agent turns. While the turn streams (`done` false), it shows a
 * live-ticking token count and a live elapsed timer. Once finalized (`done:true`)
 * it freezes the count and appends tokens/sec and the final duration. Renders
 * nothing until the first `data-acp-usage` frame arrives, so non-ACP turns are
 * unaffected.
 */
export function AcpUsageStats({
	msg,
	className,
	isLive = true,
}: {
	msg: UIMessage;
	className?: string;
	/**
	 * Whether this turn is the one currently streaming. Defaults to true so a
	 * caller that does not know keeps the old behaviour; message-list passes the
	 * chat's own status, which is `effectiveStatus` (resumed turns included), so
	 * a genuinely live reply still ticks.
	 */
	isLive?: boolean;
}) {
	// No useMemo: extractAcpUsage is a cheap array.find — memoizing it with
	// [msg] can stale during streaming when the AI SDK reconciles data parts in
	// place without replacing the message object reference.
	const usage = extractAcpUsage(msg);

	// Live elapsed timer: record when the component first mounts with usage data,
	// then tick every second while the turn is still streaming.
	const startRef = useRef<number | null>(null);
	const frozenRef = useRef<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	if (usage && startRef.current === null) {
		startRef.current = Date.now();
	}

	// `usage` is a NEW object on every streamed frame (the AI SDK replaces the
	// data part), so depending on it tore the interval down and rebuilt it every
	// frame. The two booleans below are all this effect actually reacts to.
	const isRunning = Boolean(usage) && usage?.done !== true && isLive;

	useEffect(() => {
		if (!isRunning) {
			return;
		}
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [isRunning]);

	const elapsedMs = usage
		? resolveAcpElapsedMs({
				done: usage.done,
				durationMs: usage.durationMs,
				frozenMs: frozenRef.current,
				isLive,
				now,
				startedAt: startRef.current,
			})
		: null;

	// Remember the last live measurement so an interrupted turn freezes at the
	// number the user was watching instead of dropping it.
	useEffect(() => {
		if (isRunning && elapsedMs !== null) {
			frozenRef.current = elapsedMs;
		}
	}, [isRunning, elapsedMs]);

	if (!usage) {
		return null;
	}

	const tokens = usageTokenCount(usage);
	// `> 0`, not merely present: a turn that genuinely produced tokens in under a
	// millisecond does not exist, so a rounded 0 tok/s is always noise.
	const speed =
		typeof usage.tokensPerSecond === "number" && usage.tokensPerSecond > 0
			? Math.round(usage.tokensPerSecond)
			: null;

	const duration = elapsedMs === null ? null : formatDuration(elapsedMs);
	const showSpeed = Boolean(usage.done) && speed !== null;

	// Nothing measurable at all (an agent that reports no usage on a turn that
	// also produced no timing) — render nothing rather than an empty footer row.
	if (tokens === null && !(showSpeed || duration)) {
		return null;
	}

	const row = (
		<span
			className={cn(
				"flex w-fit select-none items-center gap-1.5 text-muted-foreground tabular-nums",
				className
			)}
		>
			{tokens === null ? null : (
				<span className="inline-flex items-center gap-1">
					<NumberTicker startOnView={false} value={tokens} />
					<span>tokens</span>
				</span>
			)}
			{showSpeed ? (
				<>
					{tokens === null ? null : <span aria-hidden="true">·</span>}
					<span>{speed} tok/s</span>
				</>
			) : null}
			{duration ? (
				<>
					{tokens === null && !showSpeed ? null : (
						<span aria-hidden="true">·</span>
					)}
					<span>{duration}</span>
				</>
			) : null}
		</span>
	);

	const breakdown = acpBreakdownRows(usage);
	if (breakdown.length === 0) {
		return row;
	}
	return (
		<HoverCard>
			<HoverCardTrigger closeDelay={80} delay={120}>
				{row}
			</HoverCardTrigger>
			<HoverCardContent className="w-60 text-xs">
				<div className="flex flex-col gap-1.5">
					{breakdown.map((r) => (
						<StatRow key={r.label} label={r.label} value={r.value} />
					))}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
