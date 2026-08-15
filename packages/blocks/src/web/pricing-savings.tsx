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
import { Input } from "@ryu/ui/components/input";
import { NumberTicker } from "@ryu/ui/components/number-ticker";
import PageHeader from "@ryu/ui/components/page-header.tsx";
import { Slider } from "@ryu/ui/components/slider";
import { useMemo, useState } from "react";
import {
	annualTotalPrice,
	effectiveMonthlyPrice,
	TEAMS_INCLUDED_PER_SEAT_USD,
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
		replacedBy: "A managed node, included with your plan",
	},
];

/**
 * A cost an agent platform displaces that is NOT a software subscription.
 *
 * THE TOOL LIST ALONE UNDERSELLS THE PRODUCT, and by a wide margin. Ticking
 * every subscription above tops out at a few hundred dollars a month, because
 * that is what SOFTWARE costs — while the work those agents actually do is
 * priced in salaries, retainers and hours. A buyer comparing us against Notion
 * and Zapier is answering "which tools do we replace"; the question that
 * persuades is "what would you pay to get this done without us", and its answer
 * is an order of magnitude larger.
 *
 * These rows are EDITABLE, unlike the tool list, and that difference is
 * deliberate. A vendor's list price is a fact we can look up and be held to; an
 * SDR's loaded cost is the buyer's own number, varies by market by a factor of
 * three, and would read as a made-up claim if we asserted it. So we seed a
 * defensible default and let them correct it — the figure they typed is the one
 * they believe, which is the only figure that moves a decision.
 */
interface DisplacedCost {
	readonly category: string;
	/** Seeded monthly USD — a starting point, not a claim. */
	readonly defaultMonthlyUsd: number;
	/** Ticked on first render. Off by default: these are large numbers, and a
	 * calculator that opens by asserting a $6,000/mo saving reads as a sales
	 * trick rather than an estimate. The buyer opts in to each one. */
	readonly defaultOn: boolean;
	/** Where the default comes from, so the number is arguable rather than magic. */
	readonly hint: string;
	readonly id: string;
	readonly name: string;
	/** What Ryu does instead — one short clause. */
	readonly replacedBy: string;
}

/**
 * Seeded at deliberately CONSERVATIVE figures (2026 US mid-market), because the
 * calculator's credibility is worth more than its headline. Each is a monthly
 * cost the buyer edits to their own reality.
 */
const DISPLACED_COSTS: readonly DisplacedCost[] = [
	{
		id: "hire-sdr",
		name: "An SDR or outbound rep",
		category: "People you'd hire",
		defaultMonthlyUsd: 5000,
		defaultOn: false,
		hint: "Fully loaded monthly cost, salary plus overhead",
		replacedBy: "Agents that research, draft and follow up",
	},
	{
		id: "hire-support",
		name: "A support agent",
		category: "People you'd hire",
		defaultMonthlyUsd: 4000,
		defaultOn: false,
		hint: "One full-time support seat, fully loaded",
		replacedBy: "Agent Inboxes that triage and answer",
	},
	{
		id: "hire-analyst",
		name: "A junior analyst or researcher",
		category: "People you'd hire",
		defaultMonthlyUsd: 5500,
		defaultOn: false,
		hint: "Fully loaded monthly cost",
		replacedBy: "Research runs on a schedule, not a request",
	},
	{
		id: "hire-ops",
		name: "An ops or admin coordinator",
		category: "People you'd hire",
		defaultMonthlyUsd: 4500,
		defaultOn: false,
		hint: "Fully loaded monthly cost",
		replacedBy: "Workflows that run the recurring work",
	},
	{
		id: "ops-hours",
		name: "Ops and admin time you already spend",
		category: "Time you'd get back",
		defaultMonthlyUsd: 1600,
		defaultOn: false,
		hint: "About 10 hours a week at $40/hour, loaded",
		replacedBy: "The same work, unattended",
	},
	{
		id: "support-tickets",
		name: "Tickets handled by hand",
		category: "Time you'd get back",
		defaultMonthlyUsd: 1000,
		defaultOn: false,
		hint: "About 200 tickets a month at $5 each",
		replacedBy: "First-pass drafts on every ticket",
	},
	{
		id: "agency-content",
		name: "Content or research retainer",
		category: "Agencies and contractors",
		defaultMonthlyUsd: 3000,
		defaultOn: false,
		hint: "A typical small monthly retainer",
		replacedBy: "Drafts your team edits instead of commissions",
	},
	{
		id: "agency-leadgen",
		name: "Lead-gen or list-building retainer",
		category: "Agencies and contractors",
		defaultMonthlyUsd: 2000,
		defaultOn: false,
		hint: "A typical small monthly retainer",
		replacedBy: "Agents that build and enrich the list",
	},
	{
		id: "cac-tooling",
		name: "Outbound and sales tooling",
		category: "Going to market",
		defaultMonthlyUsd: 800,
		defaultOn: false,
		hint: "Sequencer, dialler and deliverability stack",
		replacedBy: "Channels and workflows on your own node",
	},
	{
		id: "data-enrichment",
		name: "Data and enrichment subscriptions",
		category: "Going to market",
		defaultMonthlyUsd: 1200,
		defaultOn: false,
		hint: "Apollo, Clay, ZoomInfo and similar",
		replacedBy: "Web research and enrichment as a tool call",
	},
	{
		id: "own-api-keys",
		name: "API keys you'd buy directly",
		category: "Keys you'd otherwise hold",
		defaultMonthlyUsd: 400,
		defaultOn: false,
		hint: "What you'd put on your own OpenAI, Anthropic and search accounts",
		// The keyless pass-through story: the models are billed at cost, so this
		// line is not "cheaper keys" — it is the same spend, minus the accounts,
		// the cards, the rate limits and the per-vendor minimums.
		replacedBy: "Same models at cost, without holding a single key",
	},
];

/** Both groups share one row shape for totalling; only the UI differs. */
const DISPLACED_CATEGORIES: readonly {
	name: string;
	items: readonly DisplacedCost[];
}[] = DISPLACED_COSTS.reduce<{ name: string; items: DisplacedCost[] }[]>(
	(groups, cost) => {
		const existing = groups.find((group) => group.name === cost.category);
		if (existing) {
			existing.items.push(cost);
			return groups;
		}
		groups.push({ name: cost.category, items: [cost] });
		return groups;
	},
	[]
);

const DEFAULT_DISPLACED_SELECTION = new Set(
	DISPLACED_COSTS.filter((cost) => cost.defaultOn).map((cost) => cost.id)
);

/** Seeded amounts, keyed by id, before the buyer edits any of them. */
const DEFAULT_DISPLACED_AMOUNTS: Readonly<Record<string, number>> =
	Object.fromEntries(
		DISPLACED_COSTS.map((cost) => [cost.id, cost.defaultMonthlyUsd])
	);

/**
 * Upper bound on an edited amount. Not a UX nicety: the totals feed a
 * percentage and a bar width, and a buyer who pastes a salary in cents (or
 * leans on a key) would otherwise render a "you'd save 99.9%" headline that
 * discredits the whole section.
 */
const MAX_DISPLACED_MONTHLY_USD = 1_000_000;

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
 * Included AI usage is now a PINNED per-plan amount, not a fraction of price.
 *
 * This footnote used to compute "50% of the seat price", which was true when
 * every pool derived from one rule and became a lie the moment they were pinned
 * — the page advertised $19.50/mo of included usage on a plan granting $15. The
 * caller passes the real figure; the default is Pro's.
 */

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
					<span className="font-heading font-medium tabular-nums">
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
					<span className="font-heading font-medium tabular-nums">
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
				<span className="block font-heading font-medium text-sm tabular-nums">
					{usd.format(monthly)}
					<span className="text-muted-foreground text-xs">/mo</span>
				</span>
				<span className="block text-muted-foreground text-xs">
					{tool.perSeat ? (
						<>
							<span className="font-heading tabular-nums">
								{usd.format(tool.monthlyUsd)}
							</span>
							/seat
						</>
					) : (
						"flat rate"
					)}
				</span>
			</span>
		</div>
	);
}

/** One tickable displaced-cost row, with the amount editable in place. */
function DisplacedCostRow({
	cost,
	amount,
	selected,
	onToggle,
	onAmountChange,
}: {
	amount: number;
	cost: DisplacedCost;
	onAmountChange: (id: string, next: number) => void;
	onToggle: (id: string, next: boolean) => void;
	selected: boolean;
}) {
	const inputId = `ryu-displaced-${cost.id}`;
	const amountId = `ryu-displaced-amount-${cost.id}`;
	return (
		<div className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50">
			<Checkbox
				checked={selected}
				className="mt-0.5"
				id={inputId}
				onCheckedChange={(next) => onToggle(cost.id, next === true)}
			/>
			<label className="flex-1 cursor-pointer" htmlFor={inputId}>
				<span className="block font-medium text-sm">{cost.name}</span>
				<span className="block text-muted-foreground text-xs">
					{cost.replacedBy}
				</span>
			</label>
			<span className="shrink-0 text-right">
				{/* The label is visually hidden rather than absent: the input is a bare
				    number next to a name, which a screen reader would read as an
				    unlabelled spinbutton. */}
				<label className="sr-only" htmlFor={amountId}>
					Monthly cost of {cost.name} in US dollars
				</label>
				<span className="flex items-center justify-end gap-1">
					<span className="font-heading text-muted-foreground text-sm">$</span>
					<Input
						className="font-heading h-8 w-24 text-right text-sm tabular-nums"
						id={amountId}
						inputMode="numeric"
						max={MAX_DISPLACED_MONTHLY_USD}
						min={0}
						onChange={(event) =>
							onAmountChange(cost.id, Number(event.target.value))
						}
						type="number"
						value={amount}
					/>
					<span className="text-muted-foreground text-xs">/mo</span>
				</span>
				<span className="mt-0.5 block text-muted-foreground text-xs">
					{cost.hint}
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
	includedPerSeatUsd = TEAMS_INCLUDED_PER_SEAT_USD,
	minSeats = TEAMS_MIN_SEATS,
	planName = "Teams",
	plansHref = "#plans",
	seatControl = true,
	seats: controlledSeats,
	onSeatsChange,
}: {
	/**
	 * Included AI usage per seat per month, in whole USD. Passed rather than
	 * derived: pools are pinned per plan, so no fraction of the price is correct
	 * for all of them.
	 */
	includedPerSeatUsd?: number;
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
	const [displacedSelected, setDisplacedSelected] = useState<Set<string>>(
		() => new Set(DEFAULT_DISPLACED_SELECTION)
	);
	const [displacedAmounts, setDisplacedAmounts] = useState<
		Record<string, number>
	>(() => ({ ...DEFAULT_DISPLACED_AMOUNTS }));

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

	const toggleDisplaced = (id: string, next: boolean) => {
		setDisplacedSelected((prev) => {
			const draft = new Set(prev);
			if (next) {
				draft.add(id);
			} else {
				draft.delete(id);
			}
			return draft;
		});
	};

	const setDisplacedAmount = (id: string, next: number) => {
		// Clamped, and NaN-guarded: an emptied field yields `Number("") === 0`,
		// but a partially typed one can yield NaN, which would poison the total
		// and render every downstream figure as "$NaN".
		const safe = Number.isFinite(next)
			? Math.min(Math.max(Math.round(next), 0), MAX_DISPLACED_MONTHLY_USD)
			: 0;
		setDisplacedAmounts((prev) => ({ ...prev, [id]: safe }));
	};

	const { stackAnnual, ryuAnnual, savings, savingsPct } = useMemo(() => {
		const toolsMonthly = REPLACEABLE_TOOLS.filter((tool) =>
			selected.has(tool.id)
		).reduce(
			(total, tool) =>
				total + (tool.perSeat ? tool.monthlyUsd * seats : tool.monthlyUsd),
			0
		);
		// Displaced costs are FLAT, never multiplied by seats. They are already
		// whole-org figures — one SDR, one retainer — so scaling them by the seat
		// count would multiply a salary by the size of the team paying it.
		const displacedMonthly = DISPLACED_COSTS.filter((cost) =>
			displacedSelected.has(cost.id)
		).reduce(
			(total, cost) =>
				total + (displacedAmounts[cost.id] ?? cost.defaultMonthlyUsd),
			0
		);
		const stackMonthly = toolsMonthly + displacedMonthly;
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
	}, [
		selected,
		displacedSelected,
		displacedAmounts,
		seats,
		isYearly,
		monthlyPerSeatUsd,
	]);

	const nothingSelected = selected.size === 0 && displacedSelected.size === 0;
	const ryuMonthlyPerSeat = effectiveMonthlyPrice(monthlyPerSeatUsd, isYearly);

	return (
		<section className="mx-auto mb-16 max-w-7xl">
			{/* The same title/subtitle pair the page opens with, so this section reads
			    as part of the page rather than as a differently-styled island. `as="h2"`
			    is load-bearing: the routed page already owns the `h1`. */}
			<PageHeader
				as="h2"
				className="mb-8 text-center"
				subtitle="Tick the subscriptions Ryu would replace, then add the work you'd otherwise pay people to do. Vendor prices are public monthly list rates; the rest are yours to edit."
				title="What are you paying for today?"
			/>

			<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
				{/* Both cost groups share the left column; the savings panel sticks
				    in the right one. Wrapped rather than left to grid auto-placement,
				    which would have put the second card BESIDE the first and pushed
				    the sticky panel onto a second row. */}
				<div className="space-y-8">
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

					{/* The second group, and the one that carries the argument. The card
					    above answers "which tools do we replace"; this one answers "what
					    would you pay to get this done without us", which is where the
					    number stops being a rounding error on a software budget. Kept as a
					    separate card, and separately opt-in, so the tool comparison stays
					    honest on its own — a buyer who trusts only the list prices can
					    ignore this entirely and still get a defensible figure. */}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">
								What would you pay to get this done without us?
							</CardTitle>
							<CardDescription>
								The work, not the software. These are your numbers — the
								defaults are only a starting point, so edit them to what you
								actually pay.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							{DISPLACED_CATEGORIES.map((category) => (
								<div key={category.name}>
									<p className="mb-1 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
										{category.name}
									</p>
									{category.items.map((cost) => (
										<DisplacedCostRow
											amount={
												displacedAmounts[cost.id] ?? cost.defaultMonthlyUsd
											}
											cost={cost}
											key={cost.id}
											onAmountChange={setDisplacedAmount}
											onToggle={toggleDisplaced}
											selected={displacedSelected.has(cost.id)}
										/>
									))}
								</div>
							))}
						</CardContent>
					</Card>
				</div>

				<div className="lg:sticky lg:top-24 lg:self-start">
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Your savings</CardTitle>
							<CardDescription>
								Against Ryu {planName} at{" "}
								<span className="font-heading tabular-nums">
									{usd.format(ryuMonthlyPerSeat)}
								</span>
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
									Tick what you pay for today — tools, people, or both — to see
									the difference.
								</p>
							) : (
								<>
									<div className="mt-6 flex items-baseline">
										<NumberTicker
											className="font-heading font-semibold text-4xl tabular-nums"
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
								<span className="font-heading tabular-nums">
									{usdWithCents.format(includedPerSeatUsd)}
								</span>
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
