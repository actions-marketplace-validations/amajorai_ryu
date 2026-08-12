"use client";

import { Button } from "@ryu/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card";
import { Checkbox } from "@ryu/ui/components/checkbox";
import { NumberTicker } from "@ryu/ui/components/number-ticker";
import PageHeader from "@ryu/ui/components/page-header.tsx";
import { Slider } from "@ryu/ui/components/slider";
import { useMemo, useState } from "react";
import {
	annualTotalPrice,
	effectiveMonthlyPrice,
	TEAMS_MIN_SEATS,
	TEAMS_MONTHLY_PER_SEAT_USD,
} from "./pricing.tsx";

/**
 * The "what does Ryu replace" savings calculator — the Notion-style band that
 * sits under the pricing grid: tick the subscriptions you already pay for, set a
 * seat count, and it totals the annual bill against Ryu's.
 *
 * Presentational: every number it needs is either in the tool catalog below or
 * injected as a prop, and the seat count is CONTROLLED by the page so this and
 * the seat steppers on the plan cards can never disagree.
 */

const MONTHS_PER_YEAR = 12;

/** A subscription a Ryu plan stands in for. */
interface ReplaceableTool {
	/** Grouping header this tool renders under. */
	readonly category: string;
	/** Ticked on first render — the stack a typical buyer already pays for. */
	readonly defaultOn: boolean;
	readonly id: string;
	/** List price in whole USD per month. */
	readonly monthlyUsd: number;
	readonly name: string;
	/**
	 * True when the price is charged per person; false for a workspace-wide
	 * (flat) plan that does not scale with the seat count.
	 */
	readonly perSeat: boolean;
	/** What Ryu does instead — one short clause. */
	readonly replacedBy: string;
}

/**
 * PUBLIC LIST PRICES as of 2026-07, in USD, taken from each vendor's own
 * pricing page and rounded to whole dollars. They are marketing inputs, not
 * billing inputs — nothing here is charged — but they DRIFT, so re-check them
 * when this section is next touched. Where a vendor lists both a monthly and a
 * cheaper annual rate we use the MONTHLY rate, since that is what the
 * comparison's "billed monthly" competitor column means.
 */
const REPLACEABLE_TOOLS: readonly ReplaceableTool[] = [
	{
		id: "chatgpt-plus",
		name: "ChatGPT Plus",
		category: "AI assistants",
		monthlyUsd: 20,
		perSeat: true,
		defaultOn: true,
		replacedBy: "300+ models in one chat",
	},
	{
		id: "claude-pro",
		name: "Claude Pro",
		category: "AI assistants",
		monthlyUsd: 20,
		perSeat: true,
		defaultOn: true,
		replacedBy: "Bring it, or use pooled credits",
	},
	{
		id: "perplexity-pro",
		name: "Perplexity Pro",
		category: "AI assistants",
		monthlyUsd: 20,
		perSeat: true,
		defaultOn: false,
		replacedBy: "Web search built into every agent",
	},
	{
		id: "cursor-pro",
		name: "Cursor Pro",
		category: "Coding agents",
		monthlyUsd: 20,
		perSeat: true,
		defaultOn: true,
		replacedBy: "Claude Code and Codex, hosted",
	},
	{
		id: "copilot-business",
		name: "GitHub Copilot Business",
		category: "Coding agents",
		monthlyUsd: 19,
		perSeat: true,
		defaultOn: false,
		replacedBy: "Agents that run the whole task",
	},
	{
		id: "notion-business",
		name: "Notion Business",
		category: "Docs & knowledge",
		monthlyUsd: 24,
		perSeat: true,
		defaultOn: true,
		replacedBy: "Spaces: docs your agents can read",
	},
	{
		id: "granola",
		name: "Granola Business",
		category: "Meetings",
		monthlyUsd: 18,
		perSeat: true,
		defaultOn: false,
		replacedBy: "On-device meeting notes",
	},
	{
		id: "otter-business",
		name: "Otter Business",
		category: "Meetings",
		monthlyUsd: 20,
		perSeat: true,
		defaultOn: false,
		replacedBy: "Local transcription, nothing uploaded",
	},
	{
		id: "superhuman",
		name: "Superhuman",
		category: "Email",
		monthlyUsd: 30,
		perSeat: true,
		defaultOn: false,
		replacedBy: "Agent Inboxes that triage and reply",
	},
	{
		id: "zapier-pro",
		name: "Zapier Professional",
		category: "Automation",
		monthlyUsd: 49,
		perSeat: false,
		defaultOn: true,
		replacedBy: "Workflows and schedules, unmetered",
	},
	{
		id: "make-pro",
		name: "Make Pro",
		category: "Automation",
		monthlyUsd: 19,
		perSeat: false,
		defaultOn: false,
		replacedBy: "Same graph, running on your node",
	},
	{
		id: "midjourney",
		name: "Midjourney Standard",
		category: "Creative",
		monthlyUsd: 30,
		perSeat: true,
		defaultOn: false,
		replacedBy: "Image generation on your own GPU",
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs Creator",
		category: "Creative",
		monthlyUsd: 22,
		perSeat: false,
		defaultOn: false,
		replacedBy: "Local voice and transcription",
	},
	{
		id: "agent-host",
		name: "VPS for 24/7 agents",
		category: "Infrastructure",
		monthlyUsd: 25,
		perSeat: false,
		defaultOn: false,
		replacedBy: "A managed node, included with Max",
	},
];

/** The catalog grouped into the order the categories first appear. */
const TOOL_CATEGORIES: readonly {
	name: string;
	tools: readonly ReplaceableTool[];
}[] = REPLACEABLE_TOOLS.reduce<{ name: string; tools: ReplaceableTool[] }[]>(
	(groups, tool) => {
		const existing = groups.find((group) => group.name === tool.category);
		if (existing) {
			existing.tools.push(tool);
			return groups;
		}
		groups.push({ name: tool.category, tools: [tool] });
		return groups;
	},
	[]
);

const DEFAULT_SELECTION = new Set(
	REPLACEABLE_TOOLS.filter((tool) => tool.defaultOn).map((tool) => tool.id)
);

/** Whole-dollar USD ("$1,170"). */
const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});

/** USD that keeps cents when there are any ("$19.50", but "$20"). */
const usdWithCents = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

/** Seat range the slider offers before the copy points at Enterprise. */
const SEAT_SLIDER_MAX = 50;
/** Where the slider starts when this section owns its own seat state. */
const DEFAULT_LOCAL_SEATS = 5;
/**
 * The fraction of a per-seat price granted back as included AI usage — the 50%
 * default in `includedCreditPoolMicroUsd`. Mirrored here only to phrase the
 * footnote; nothing is billed from it.
 */
const INCLUDED_CREDIT_FRACTION = 0.5;

/**
 * The comparison bar: two stacked tracks, the wider one being whatever costs
 * more. Purely decorative — the figures above it carry the real information —
 * so it is `aria-hidden` and the totals are read out in text.
 */
function ComparisonBars({
	stackAnnual,
	ryuAnnual,
}: {
	stackAnnual: number;
	ryuAnnual: number;
}) {
	const widest = Math.max(stackAnnual, ryuAnnual, 1);
	const stackWidth = Math.round((stackAnnual / widest) * 100);
	const ryuWidth = Math.round((ryuAnnual / widest) * 100);
	return (
		<div aria-hidden className="mt-6 space-y-3">
			<div>
				<div className="mb-1 flex justify-between text-xs">
					<span className="text-muted-foreground">Your current tools</span>
					<span className="font-medium tabular-nums">
						{usd.format(stackAnnual)}/yr
					</span>
				</div>
				<div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-muted-foreground/40 transition-[width] duration-500 ease-out"
						style={{ width: `${stackWidth}%` }}
					/>
				</div>
			</div>
			<div>
				<div className="mb-1 flex justify-between text-xs">
					<span className="text-muted-foreground">Ryu</span>
					<span className="font-medium tabular-nums">
						{usd.format(ryuAnnual)}/yr
					</span>
				</div>
				<div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
						style={{ width: `${ryuWidth}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

/** One tickable tool row. */
function ToolRow({
	tool,
	seats,
	selected,
	onToggle,
}: {
	tool: ReplaceableTool;
	seats: number;
	selected: boolean;
	onToggle: (id: string, next: boolean) => void;
}) {
	const monthly = tool.perSeat ? tool.monthlyUsd * seats : tool.monthlyUsd;
	const inputId = `ryu-savings-${tool.id}`;
	return (
		<div className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50">
			<Checkbox
				checked={selected}
				className="mt-0.5"
				id={inputId}
				onCheckedChange={(next) => onToggle(tool.id, next === true)}
			/>
			<label className="flex-1 cursor-pointer" htmlFor={inputId}>
				<span className="block font-medium text-sm">{tool.name}</span>
				<span className="block text-muted-foreground text-xs">
					{tool.replacedBy}
				</span>
			</label>
			<span className="shrink-0 text-right">
				<span className="block font-medium text-sm tabular-nums">
					{usd.format(monthly)}
					<span className="text-muted-foreground text-xs">/mo</span>
				</span>
				<span className="block text-muted-foreground text-xs">
					{tool.perSeat ? `${usd.format(tool.monthlyUsd)}/seat` : "flat rate"}
				</span>
			</span>
		</div>
	);
}

/**
 * Total cost savings from replacing a stack of point tools with one Ryu plan.
 *
 * `seats` / `onSeatsChange` are optional: when the page owns the seat count
 * (the pricing page does, so the plan cards and this section stay in sync) it
 * passes both; left off, the section keeps its own local seat state so it can
 * be dropped on any marketing page standalone.
 */
export function PricingSavingsCalculator({
	isYearly = false,
	monthlyPerSeatUsd = TEAMS_MONTHLY_PER_SEAT_USD,
	minSeats = TEAMS_MIN_SEATS,
	planName = "Teams",
	plansHref = "#plans",
	seatControl = true,
	seats: controlledSeats,
	onSeatsChange,
}: {
	isYearly?: boolean;
	/**
	 * Seat floor of the plan being compared against. The slider MUST NOT go below
	 * it: the seat count is shared with the plan cards, and a count the plan
	 * cannot be bought at would price a purchase that does not exist (and, since
	 * the cards clamp for display, would show two different totals on one screen).
	 */
	minSeats?: number;
	monthlyPerSeatUsd?: number;
	onSeatsChange?: (seats: number) => void;
	planName?: string;
	/** Where "Compare plans" points; the default assumes the pricing page. */
	plansHref?: string;
	/**
	 * Whether the seat slider is offered. Set `false` on a SOLO plan (Lifetime,
	 * Pro): those are bought one seat at a time, so a slider offering fifty of
	 * them prices a purchase the plan cannot be made at, and the per-seat wording
	 * throughout would be describing a team the reader does not have.
	 */
	seatControl?: boolean;
	seats?: number;
}) {
	const [localSeats, setLocalSeats] = useState(() =>
		Math.max(DEFAULT_LOCAL_SEATS, minSeats)
	);
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(DEFAULT_SELECTION)
	);

	// A solo plan is priced at exactly one seat regardless of what the page (or a
	// stale local value) is holding, so the totals can never quote a team price.
	const seats = seatControl
		? Math.max(controlledSeats ?? localSeats, minSeats)
		: 1;
	const setSeats = (next: number) => {
		const clamped = Math.max(next, minSeats);
		if (onSeatsChange) {
			onSeatsChange(clamped);
			return;
		}
		setLocalSeats(clamped);
	};

	const toggle = (id: string, next: boolean) => {
		setSelected((prev) => {
			const draft = new Set(prev);
			if (next) {
				draft.add(id);
			} else {
				draft.delete(id);
			}
			return draft;
		});
	};

	const { stackAnnual, ryuAnnual, savings, savingsPct } = useMemo(() => {
		const stackMonthly = REPLACEABLE_TOOLS.filter((tool) =>
			selected.has(tool.id)
		).reduce(
			(total, tool) =>
				total + (tool.perSeat ? tool.monthlyUsd * seats : tool.monthlyUsd),
			0
		);
		// Competitors are totalled at their MONTHLY list rate over a year; Ryu is
		// totalled at whichever term the page's billing toggle is on, so the yearly
		// toggle's two free months show up in the comparison.
		const stackYear = stackMonthly * MONTHS_PER_YEAR;
		const ryuYear =
			(isYearly
				? annualTotalPrice(monthlyPerSeatUsd)
				: monthlyPerSeatUsd * MONTHS_PER_YEAR) * seats;
		const saved = stackYear - ryuYear;
		return {
			stackAnnual: stackYear,
			ryuAnnual: ryuYear,
			savings: saved,
			savingsPct: stackYear > 0 ? Math.round((saved / stackYear) * 100) : 0,
		};
	}, [selected, seats, isYearly, monthlyPerSeatUsd]);

	const nothingSelected = selected.size === 0;
	const ryuMonthlyPerSeat = effectiveMonthlyPrice(monthlyPerSeatUsd, isYearly);

	return (
		<section className="mx-auto mb-16 max-w-7xl">
			{/* The same title/subtitle pair the page opens with, so this section reads
			    as part of the page rather than as a differently-styled island. `as="h2"`
			    is load-bearing: the routed page already owns the `h1`. */}
			<PageHeader
				as="h2"
				className="mb-8 text-center"
				subtitle="Tick the subscriptions Ryu would replace and we'll do the arithmetic. Prices are each vendor's public monthly list rate."
				title="What are you paying for today?"
			/>

			<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Your current stack</CardTitle>
						<CardDescription>
							Per-seat tools scale with the seat count; flat-rate tools
							don&apos;t.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						{TOOL_CATEGORIES.map((category) => (
							<div key={category.name}>
								<p className="mb-1 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
									{category.name}
								</p>
								{category.tools.map((tool) => (
									<ToolRow
										key={tool.id}
										onToggle={toggle}
										seats={seats}
										selected={selected.has(tool.id)}
										tool={tool}
									/>
								))}
							</div>
						))}
					</CardContent>
				</Card>

				<div className="lg:sticky lg:top-24 lg:self-start">
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Your savings</CardTitle>
							<CardDescription>
								Against Ryu {planName} at {usd.format(ryuMonthlyPerSeat)}
								{seatControl ? "/seat" : ""}/mo
								{isYearly ? ", billed yearly" : ""}.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{seatControl ? (
								<>
									<p className="mb-2 font-medium text-muted-foreground text-xs">
										Seats: <span className="text-foreground">{seats}</span>
									</p>
									<Slider
										aria-label="Number of seats"
										max={SEAT_SLIDER_MAX}
										min={minSeats}
										onValueChange={(value: number | readonly number[]) =>
											setSeats(
												Array.isArray(value) ? value[0] : (value as number)
											)
										}
										value={[seats]}
									/>
									<p className="mt-1 text-muted-foreground text-xs">
										Over {SEAT_SLIDER_MAX} seats? Talk to us about Enterprise.
									</p>
								</>
							) : (
								<p className="text-muted-foreground text-xs">
									Priced for one person. Buying for a team? Switch to Business
									&amp; Enterprise above.
								</p>
							)}

							{nothingSelected ? (
								<p className="mt-6 text-muted-foreground text-sm">
									Tick the tools you already pay for to see the difference.
								</p>
							) : (
								<>
									<div className="mt-6 flex items-baseline">
										<NumberTicker
											className="font-semibold text-4xl"
											prefix={savings < 0 ? "-$" : "$"}
											value={Math.abs(savings)}
										/>
										<span className="ml-1 text-muted-foreground">/year</span>
									</div>
									<p className="mt-1 text-muted-foreground text-sm">
										{savings > 0
											? `You'd save ${savingsPct}% by consolidating onto Ryu.`
											: "Ryu costs more than the tools you picked — pick the ones you actually pay for."}
									</p>
									<ComparisonBars
										ryuAnnual={ryuAnnual}
										stackAnnual={stackAnnual}
									/>
								</>
							)}

							<Button className="mt-6 w-full" render={<a href={plansHref} />}>
								Compare plans
							</Button>
							<p className="mt-3 text-muted-foreground text-xs">
								Ryu {planName} also includes{" "}
								{usdWithCents.format(
									monthlyPerSeatUsd * INCLUDED_CREDIT_FRACTION
								)}
								{seatControl ? "/seat" : ""}/mo of AI usage, so the model bills
								the tools above charge you for are already in the number.
							</p>
						</CardContent>
					</Card>
				</div>
			</div>
		</section>
	);
}
