"use client";

/*
 * The landing hero's visualisation: a looping, scripted run of ONE real Ryu
 * workflow across BOTH surfaces, so the two-surface story is shown instead of
 * asserted.
 *
 *   Island (always on top, glanceable)  →  Desktop app (where the work runs)
 *
 * The beat list is the whole script: every visual — island state, cursor,
 * transcript contents, caption, phase chip — is DERIVED from the current beat
 * index, so the loop restarting is just `index = 0` and there is no accumulated
 * state to drift. Beats advance on a timer that only runs while the stage is on
 * screen; `prefers-reduced-motion` freezes it on the finished beat instead.
 *
 * Like the showcase it replaces, this is NOT a redrawn approximation: it composes
 * the same real `DesktopShell` + `AgentChat` the app ships, and the island is the
 * real island shape vocabulary from `island-shapes.tsx`. The transcript is fed
 * real AI-SDK v5 tool parts, so the tool rows are the app's own renderers.
 *
 * The persistent site island (`GlobalIsland`) is suppressed while this stage is
 * visible — one island on screen at a time.
 */

import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { Logo as RyuLogo } from "@ryu/ui/components/logo";
import { cn } from "@ryu/ui/lib/utils";
import type { ChatStatus, UIMessage } from "ai";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChat } from "../desktop/agent-elements/agent-chat.tsx";
import { DesktopShell } from "../desktop/shell.tsx";
import { IslandSuggestionChip } from "../island/suggestion-chip.tsx";
import {
	ACTION_PILL_HEIGHT,
	ACTION_PILL_WIDTH,
	CONTENT_SPRING,
	DETAIL_SIZES,
	ISLAND_CSS,
	ISLAND_SPRING,
	type IslandAction,
	IslandActionPills,
	LOGO_CIRCLE,
	SHAPE_BASE,
	SPLIT_GAP,
	SUGGESTION_STACK_GAP,
	TRANSLUCENT_SKIN,
} from "./island-shapes.tsx";
import {
	type IslandState,
	setIslandHasPromo,
	setIslandSuppressed,
} from "./island-store.ts";

/* ── the transcript the desktop half plays back ────────────────────────────── */

const textMessage = (
	id: string,
	role: "user" | "assistant",
	text: string
): UIMessage =>
	({ id, role, parts: [{ type: "text", text }] }) as unknown as UIMessage;

type Part = Record<string, unknown>;

const toolPart = (
	name: string,
	input: Record<string, unknown>,
	output: Record<string, unknown>
): Part => ({
	type: `tool-${name}`,
	toolCallId: `hero-${name}`,
	input,
	output,
});

/** The conversation on screen before the island interrupts — the app at rest. */
const IDLE_THREAD: UIMessage[] = [
	textMessage("idle-user", "user", "What's left on my plate this afternoon?"),
	textMessage(
		"idle-assistant",
		"assistant",
		"Two things: the Block71 sync at 3, and the Q3 report draft. I'll watch the call and pick up anything that turns into work."
	),
];

const TASK_PROMPT =
	"Draft the Block71 follow-up, log it against the deal, and post the summary to #sales.";

/**
 * The assistant turn, part by part. The loop reveals these one at a time, with
 * the newest tool row held in its running state for a beat before it resolves.
 */
const RUN_PARTS: Part[] = [
	{
		type: "text",
		text: "On it. Reading today's Block71 transcript from your Meetings space — that stays on this machine.",
	},
	toolPart(
		"Read",
		{ file_path: "~/Ryu/Spaces/Meetings/block71-sync.md" },
		{ preview: "42 min transcript · 3 action items · decision due Friday" }
	),
	toolPart(
		"mcp__gmail__create_draft",
		{
			to: "ops@block71.co",
			subject: "Block71 × Ryu — follow-up and next steps",
		},
		{ id: "draft_8241", status: "draft saved" }
	),
	toolPart(
		"mcp__hubspot__create_note",
		{
			deal: "Block71 — pilot",
			body: "3 action items agreed, decision due Friday.",
		},
		{ id: "note_5512" }
	),
	toolPart(
		"mcp__slack__send_message",
		{
			channel: "#sales",
			text: "Block71 pilot: follow-up drafted, decision due Friday.",
		},
		{ ok: true }
	),
	{
		type: "text",
		text: "Done. The draft is waiting in your inbox, the deal has the notes, and #sales is posted. Four tools, one accept — and the transcript itself stayed on your machine; only the summary you approved went out.",
	},
];

/** Slice the turn to `count` parts, holding the last tool row mid-run. */
function assistantParts(count: number, pending: boolean): Part[] {
	const shown = RUN_PARTS.slice(0, count);
	return shown.map((part, index) => {
		const isTool =
			typeof part.type === "string" && part.type.startsWith("tool");
		if (!isTool) {
			return part;
		}
		const isLast = index === shown.length - 1;
		if (isLast && pending) {
			const { output, ...rest } = part;
			return { ...rest, state: "input-available" };
		}
		return { ...part, state: "output-available" };
	});
}

/* ── the script ────────────────────────────────────────────────────────────── */

type Phase = "notice" | "accept" | "run" | "done";

interface Beat {
	caption: string;
	/** Which surface the annotation highlights on this beat. */
	focus: "island" | "desktop";
	/** ms this beat stays on screen. */
	hold: number;
	id: string;
	island: {
		cursor: "away" | "hover" | "press";
		pill?: string;
		state: Extract<IslandState, "collapsed" | "idle" | "suggestion">;
	};
	phase: Phase;
	/** Parts of the assistant turn revealed, and whether the last one is running. */
	run: { parts: number; pending: boolean; streaming: boolean };
	thread: "idle" | "task";
	trail?: boolean;
}

const RUN_BEAT = (
	id: string,
	parts: number,
	pending: boolean,
	caption: string,
	hold = 1500
): Beat => ({
	id,
	hold,
	caption,
	phase: "run",
	focus: "desktop",
	island: { state: "idle", pill: "Working", cursor: "away" },
	thread: "task",
	run: { parts, pending, streaming: true },
});

const BEATS: Beat[] = [
	{
		id: "watch",
		hold: 1800,
		caption:
			"Ryu rides on top of whatever you're doing — one pill, not another window to check.",
		phase: "notice",
		focus: "island",
		island: { state: "idle", pill: "Ryu", cursor: "away" },
		thread: "idle",
		run: { parts: 0, pending: false, streaming: false },
	},
	{
		id: "notice",
		hold: 2600,
		caption:
			"Your 3pm ends. The Island already knows what happened and offers the next step — nothing to open, nothing to prompt.",
		phase: "notice",
		focus: "island",
		island: { state: "suggestion", cursor: "away" },
		thread: "idle",
		run: { parts: 0, pending: false, streaming: false },
	},
	{
		id: "reach",
		hold: 900,
		caption: "Accept, snooze or dismiss. That is the whole decision.",
		phase: "accept",
		focus: "island",
		island: { state: "suggestion", cursor: "hover" },
		thread: "idle",
		run: { parts: 0, pending: false, streaming: false },
	},
	{
		id: "accept",
		hold: 750,
		caption: "Accept.",
		phase: "accept",
		focus: "island",
		island: { state: "suggestion", cursor: "press" },
		thread: "idle",
		run: { parts: 0, pending: false, streaming: false },
	},
	{
		id: "handoff",
		hold: 1400,
		caption:
			"The job lands in the desktop app — the surface that holds your tools, permissions and history.",
		phase: "run",
		focus: "desktop",
		island: { state: "idle", pill: "Handing off", cursor: "away" },
		thread: "task",
		run: { parts: 0, pending: false, streaming: true },
		trail: true,
	},
	RUN_BEAT(
		"run-intro",
		1,
		false,
		"The run opens as a real thread you can read, interrupt and rerun."
	),
	RUN_BEAT(
		"run-read",
		2,
		true,
		"Step 1 — it reads the meeting transcript straight off your machine."
	),
	RUN_BEAT(
		"run-draft",
		3,
		true,
		"Step 2 — it drafts the follow-up in Gmail, using the connector you already granted.",
		1600
	),
	RUN_BEAT(
		"run-crm",
		4,
		true,
		"Step 3 — it logs the outcome against the deal in your CRM.",
		1600
	),
	RUN_BEAT(
		"run-slack",
		5,
		true,
		"Step 4 — it posts the summary where your team will see it."
	),
	{
		id: "done",
		hold: 3200,
		caption:
			"One accept on the Island. The full run — every tool call, every file it touched — on the desktop.",
		phase: "done",
		focus: "desktop",
		island: { state: "idle", pill: "Done", cursor: "away" },
		thread: "task",
		run: { parts: RUN_PARTS.length, pending: false, streaming: false },
	},
	{
		id: "rest",
		hold: 2000,
		caption:
			"Your keys, your machine, and your call on what leaves it. The Island goes quiet until the next thing worth doing.",
		phase: "done",
		focus: "island",
		island: { state: "collapsed", cursor: "away" },
		thread: "task",
		run: { parts: RUN_PARTS.length, pending: false, streaming: false },
	},
];

const beatIndexOf = (id: string) => BEATS.findIndex((beat) => beat.id === id);
const DONE_BEAT_INDEX = beatIndexOf("done");
const HANDOFF_BEAT_INDEX = beatIndexOf("handoff");
const REST_BEAT_INDEX = beatIndexOf("rest");

const PHASES: { id: Phase; label: string }[] = [
	{ id: "notice", label: "Island notices" },
	{ id: "accept", label: "You accept" },
	{ id: "run", label: "Desktop runs it" },
	{ id: "done", label: "Work is done" },
];

const SUGGESTION = {
	title: "Your Block71 sync just ended",
	// One line: the island's chip truncates, it never wraps.
	body: "Draft the follow-up and log the deal?",
};

/**
 * The pills are real buttons under an animated pointer, so they have to do what
 * they say: a visitor who beats the script to the click runs the same handoff.
 */
function demoActions(jumpTo: (index: number) => void): IslandAction[] {
	return [
		{
			key: "accept",
			label: "Accept",
			primary: true,
			onClick: () => jumpTo(HANDOFF_BEAT_INDEX),
		},
		{ key: "snooze", label: "Snooze", onClick: () => jumpTo(REST_BEAT_INDEX) },
		{
			key: "dismiss",
			label: "Dismiss",
			onClick: () => jumpTo(REST_BEAT_INDEX),
		},
	];
}

/* ── the scripted island ───────────────────────────────────────────────────── */

// Where the pointer sits when it is over the Accept pill, in island-local space.
const CURSOR_TARGET = {
	x: LOGO_CIRCLE.width + SPLIT_GAP + ACTION_PILL_WIDTH / 2,
	y: LOGO_CIRCLE.height + SUGGESTION_STACK_GAP + ACTION_PILL_HEIGHT / 2,
};
const CURSOR_PARKED = { x: CURSOR_TARGET.x + 150, y: CURSOR_TARGET.y + 70 };

function DemoCursor({ mode }: { mode: Beat["island"]["cursor"] }) {
	const away = mode === "away";
	const target = away ? CURSOR_PARKED : CURSOR_TARGET;
	return (
		<motion.div
			animate={{
				x: target.x,
				y: target.y,
				opacity: away ? 0 : 1,
				scale: mode === "press" ? 0.86 : 1,
			}}
			className="pointer-events-none absolute top-0 left-0 z-30"
			initial={false}
			transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
		>
			{mode === "press" ? (
				<motion.span
					animate={{ scale: 2.2, opacity: 0 }}
					className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200/70"
					initial={{ scale: 0.4, opacity: 0.9 }}
					transition={{ duration: 0.55 }}
				/>
			) : null}
			<svg
				aria-hidden="true"
				className="drop-shadow-[0_2px_7px_rgba(0,0,0,0.7)]"
				fill="none"
				height="28"
				viewBox="0 0 16 22"
				width="20"
			>
				<title>Pointer</title>
				<path
					d="M1 1.5 13.4 12.1h-5.7l-2.3 5.6z"
					fill="white"
					stroke="rgba(0,0,0,0.75)"
					strokeWidth="1.4"
				/>
			</svg>
		</motion.div>
	);
}

function IslandDetail({ state, pill }: { state: IslandState; pill?: string }) {
	if (state === "suggestion") {
		return <IslandSuggestionChip suggestion={SUGGESTION} />;
	}
	return (
		<span className="truncate font-medium text-neutral-100 text-sm">
			{pill ?? "Ryu"}
		</span>
	);
}

function DemoIsland({
	beat,
	jumpTo,
}: {
	beat: Beat;
	jumpTo: (index: number) => void;
}) {
	const { state, pill, cursor } = beat.island;
	const detail = DETAIL_SIZES[state];
	const detailClass =
		state === "suggestion"
			? "flex h-full w-full items-center px-3"
			: "flex h-full w-full items-center justify-center px-4";

	return (
		<div className="relative flex flex-col items-start">
			<div className="flex items-start" style={{ gap: SPLIT_GAP }}>
				<div
					className={`${SHAPE_BASE} ${TRANSLUCENT_SKIN}`}
					style={{
						width: LOGO_CIRCLE.width,
						height: LOGO_CIRCLE.height,
						borderRadius: LOGO_CIRCLE.radius,
					}}
				>
					<div className="flex h-full w-full items-center justify-center">
						<RyuLogo className="text-current" size="34px" variant="eyes" />
					</div>
				</div>

				<AnimatePresence initial={false}>
					{detail ? (
						<motion.div
							animate={{
								width: detail.width,
								height: detail.height,
								borderRadius: detail.radius,
								opacity: 1,
							}}
							className={`${SHAPE_BASE} ${TRANSLUCENT_SKIN}`}
							exit={{ width: 0, opacity: 0 }}
							initial={{ width: 0, opacity: 0 }}
							key="detail"
							transition={ISLAND_SPRING}
						>
							<AnimatePresence initial={false} mode="wait">
								<motion.div
									animate={{ opacity: 1, scale: 1, y: 0 }}
									className={detailClass}
									exit={{ opacity: 0, scale: 0.92, y: -6 }}
									initial={{ opacity: 0, scale: 0.92, y: 6 }}
									key={`${state}-${pill ?? ""}`}
									transition={CONTENT_SPRING}
								>
									<IslandDetail pill={pill} state={state} />
								</motion.div>
							</AnimatePresence>
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>

			<AnimatePresence initial={false}>
				{state === "suggestion" ? (
					<motion.div exit={{ opacity: 0, y: -6 }} key="pills">
						<IslandActionPills
							actions={demoActions(jumpTo)}
							pressedKey={cursor === "press" ? "accept" : null}
						/>
					</motion.div>
				) : null}
			</AnimatePresence>

			<DemoCursor mode={cursor} />
		</div>
	);
}

/* ── the annotations that name each surface ────────────────────────────────── */

/**
 * The two-surface legend. It rides ABOVE the window rather than floating inside
 * it: labels dropped on the app chrome cover the very UI they are naming.
 */
function SurfaceLegend({ focus }: { focus: Beat["focus"] }) {
	const surfaces = [
		{
			id: "island" as const,
			title: "Island",
			subtitle: "Always on top · one glance, one click",
		},
		{
			id: "desktop" as const,
			title: "Desktop app",
			subtitle: "Tools, permissions, history · the full run",
		},
	];
	return (
		<div className="flex flex-wrap items-center gap-2">
			{surfaces.map((surface) => (
				<div
					className={cn(
						"flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors duration-500",
						focus === surface.id
							? "border-foreground/25 bg-background text-foreground shadow-sm"
							: "border-border/60 bg-background/60 text-muted-foreground"
					)}
					key={surface.id}
				>
					<span
						className={cn(
							"size-1.5 rounded-full transition-colors duration-500",
							focus === surface.id ? "bg-emerald-500" : "bg-muted-foreground/40"
						)}
					/>
					<span className="font-medium text-xs">{surface.title}</span>
					<span className="hidden text-[11px] text-muted-foreground lg:inline">
						{surface.subtitle}
					</span>
				</div>
			))}
		</div>
	);
}

/** The three dots that travel from the island to the window on the handoff. */
function HandoffTrail({ shown }: { shown: boolean }) {
	if (!shown) {
		return null;
	}
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 z-20"
		>
			{[0, 1, 2].map((index) => (
				<motion.span
					animate={{ left: "58%", top: "22%", opacity: [0, 1, 0] }}
					className="absolute size-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_2px_rgba(252,211,77,0.55)]"
					initial={{ left: "31%", top: "74%", opacity: 0 }}
					key={`trail-${index}`}
					transition={{ duration: 0.9, delay: index * 0.16, ease: "easeOut" }}
				/>
			))}
		</div>
	);
}

/* ── the desktop half ──────────────────────────────────────────────────────── */

function Selector({ label, value }: { label: string; value: string }) {
	return (
		<button
			className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-accent"
			type="button"
		>
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-medium">{value}</span>
			<span className="text-muted-foreground">⌄</span>
		</button>
	);
}

function ChatTopBar({ thread }: { thread: Beat["thread"] }) {
	return (
		<header className="flex items-center gap-2 border-border border-b px-4 py-2.5">
			<Selector label="Agent" value="Ryu" />
			<Selector label="Model" value="claude-opus-4-8" />
			<Selector label="Space" value="Meetings" />
			<div className="ml-auto flex items-center gap-2">
				<AnimatePresence initial={false} mode="wait">
					<motion.div
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						initial={{ opacity: 0, y: 4 }}
						key={thread}
						transition={{ duration: 0.25 }}
					>
						<Badge variant={thread === "task" ? "default" : "outline"}>
							{thread === "task" ? "From the Island" : "Local"}
						</Badge>
					</motion.div>
				</AnimatePresence>
				<Button size="icon-sm" variant="ghost">
					⋯
				</Button>
			</div>
		</header>
	);
}

/* ── the phase strip + caption ─────────────────────────────────────────────── */

function PhaseStrip({ phase }: { phase: Phase }) {
	return (
		<div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-full border border-border/60 bg-background/80 px-1.5 py-1.5 backdrop-blur-md">
			{PHASES.map((item, index) => (
				<span className="flex items-center gap-1" key={item.id}>
					{index > 0 ? (
						<span
							aria-hidden="true"
							className="text-muted-foreground/50 text-xs"
						>
							›
						</span>
					) : null}
					<span
						className={cn(
							"rounded-full px-2.5 py-1 text-xs transition-colors duration-500",
							phase === item.id
								? "bg-foreground font-medium text-background"
								: "text-muted-foreground"
						)}
					>
						{item.label}
					</span>
				</span>
			))}
		</div>
	);
}

/* ── the stage: a fixed-size window, scaled to whatever width it gets ──────── */

// The desktop window is drawn at ONE size and scaled to fit. A real desktop
// sidebar + transcript reflowed into a 390px phone reads as a broken app, not a
// small one — so the mock keeps its proportions and shrinks, cropping its right
// edge below the floor scale rather than squeezing the layout.
const STAGE_WIDTH = 1120;
const STAGE_HEIGHT = 600;
const MIN_STAGE_SCALE = 0.5;

function useStageScale() {
	const frameRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	useEffect(() => {
		const node = frameRef.current;
		if (!node) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? STAGE_WIDTH;
			// No upper cap: on a wide container the window fills the frame rather
			// than leaving a gap down its right-hand side.
			setScale(Math.max(MIN_STAGE_SCALE, width / STAGE_WIDTH));
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	return { frameRef, scale };
}

/* ── the loop ──────────────────────────────────────────────────────────────── */

// The launch discount is a rare surprise: it only surfaces on ~1 in 10 loads.
const PROMO_CHANCE = 0.1;
const TAKEOVER_REPLY =
	"Happy to. On the desktop I can run that end to end — tools, files and all — and the Island will ping you when it's done.";

function useBeatLoop(paused: boolean) {
	const reduceMotion = useReducedMotion();
	const [index, setIndex] = useState(0);
	const [visible, setVisible] = useState(true);
	const stageRef = useRef<HTMLDivElement>(null);

	// Reduced motion: skip straight to the finished run and never advance.
	useEffect(() => {
		if (reduceMotion) {
			setIndex(DONE_BEAT_INDEX);
		}
	}, [reduceMotion]);

	// Only spend frames on a loop the visitor can actually see.
	useEffect(() => {
		const node = stageRef.current;
		if (!node) {
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => setVisible(Boolean(entry?.isIntersecting)),
			{ threshold: 0.15 }
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (reduceMotion || paused || !visible) {
			return;
		}
		const timer = window.setTimeout(
			() => setIndex((i) => (i + 1) % BEATS.length),
			BEATS[index]?.hold ?? 1500
		);
		return () => window.clearTimeout(timer);
	}, [index, paused, visible, reduceMotion]);

	return { beat: BEATS[index] ?? BEATS[0], index, stageRef, setIndex, visible };
}

export function HeroWorkflowLoop() {
	// Rolled once on mount (client-only) so SSR/hydration stay in sync. Seeds the
	// persistent GlobalIsland (root layout) with whether the promo is available.
	useEffect(() => {
		setIslandHasPromo(Math.random() < PROMO_CHANCE);
	}, []);

	// While the visitor is typing in the demo, the script stops and the chat is
	// theirs — the same "take it over" affordance the old showcase had.
	const [takeover, setTakeover] = useState<UIMessage[] | null>(null);
	const [takeoverStatus, setTakeoverStatus] = useState<ChatStatus>("ready");
	const { beat, stageRef, setIndex, visible } = useBeatLoop(takeover !== null);
	const { frameRef, scale } = useStageScale();

	// One island on screen: stand the persistent site island down while the stage
	// is in view — it draws its own — and hand it back once the visitor scrolls
	// past, so the rest of the page keeps its floating island.
	useEffect(() => {
		setIslandSuppressed(visible);
		return () => setIslandSuppressed(false);
	}, [visible]);

	const scriptedMessages = useMemo<UIMessage[]>(() => {
		if (beat.thread === "idle") {
			return IDLE_THREAD;
		}
		const messages: UIMessage[] = [
			textMessage("task-user", "user", TASK_PROMPT),
		];
		if (beat.run.parts > 0) {
			messages.push({
				id: "task-assistant",
				role: "assistant",
				parts: assistantParts(beat.run.parts, beat.run.pending),
			} as unknown as UIMessage);
		}
		return messages;
	}, [beat]);

	const messages = takeover ?? scriptedMessages;

	const onSend = useCallback(
		(message: { role: "user"; content: string }) => {
			const trimmed = message.content.trim();
			if (!trimmed) {
				return;
			}
			const base = takeover ?? scriptedMessages;
			setTakeover([
				...base,
				textMessage(`takeover-${base.length}`, "user", trimmed),
			]);
			setTakeoverStatus("streaming");
			window.setTimeout(() => {
				setTakeover((prev) =>
					prev
						? [
								...prev,
								textMessage(
									`takeover-reply-${prev.length}`,
									"assistant",
									TAKEOVER_REPLY
								),
							]
						: prev
				);
				setTakeoverStatus("ready");
			}, 700);
		},
		[scriptedMessages, takeover]
	);

	const restart = useCallback(() => {
		setTakeover(null);
		setTakeoverStatus("ready");
		setIndex(0);
	}, [setIndex]);

	const status: ChatStatus = takeover
		? takeoverStatus
		: beat.run.streaming && beat.run.pending
			? "streaming"
			: "ready";

	return (
		<div className="mx-auto w-full max-w-6xl">
			{/* Static, in-repo CSS injected as a text child (no user input, no XSS surface). */}
			<style>{ISLAND_CSS}</style>

			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<PhaseStrip phase={beat.phase} />
				<div className="flex flex-wrap items-center gap-2">
					<SurfaceLegend focus={takeover ? "desktop" : beat.focus} />
					{takeover ? (
						<Button onClick={restart} size="sm" variant="secondary">
							Replay the workflow
						</Button>
					) : null}
				</div>
			</div>

			<div
				className={cn(
					"overflow-hidden rounded-2xl shadow-2xl ring-1 transition-[box-shadow,--tw-ring-color] duration-500",
					beat.focus === "desktop" && !takeover
						? "ring-foreground/25"
						: "ring-border"
				)}
				ref={frameRef}
				style={{ height: STAGE_HEIGHT * scale }}
			>
				<div
					className="relative origin-top-left bg-background"
					ref={stageRef}
					style={{
						width: STAGE_WIDTH,
						height: STAGE_HEIGHT,
						transform: `scale(${scale})`,
					}}
				>
					<DesktopShell>
						<ChatTopBar thread={takeover ? "task" : beat.thread} />
						<AgentChat
							messages={messages}
							onSend={onSend}
							onStop={() => setTakeoverStatus("ready")}
							status={status}
						/>
					</DesktopShell>

					<HandoffTrail shown={Boolean(beat.trail) && !takeover} />

					{/* The island floats over the window, exactly as it does on a real
					    desktop — over the transcript, clear of the app's own sidebar. */}
					<div className="absolute top-[26rem] left-[30%] z-30">
						{takeover ? null : <DemoIsland beat={beat} jumpTo={setIndex} />}
					</div>
				</div>
			</div>

			<div className="mt-4 min-h-[3.5rem] md:min-h-[3rem]">
				<AnimatePresence initial={false} mode="wait">
					<motion.p
						animate={{ opacity: 1, y: 0 }}
						className="inline-block max-w-3xl rounded-xl border border-border/60 bg-background/85 px-3 py-2 text-foreground text-sm leading-snug backdrop-blur-md"
						exit={{ opacity: 0, y: -4 }}
						initial={{ opacity: 0, y: 4 }}
						key={takeover ? "takeover" : beat.id}
						transition={{ duration: 0.28 }}
					>
						{takeover
							? "It's your chat now — the demo is live, not a video. Replay the workflow whenever you like."
							: beat.caption}
					</motion.p>
				</AnimatePresence>
			</div>
		</div>
	);
}

export default HeroWorkflowLoop;
