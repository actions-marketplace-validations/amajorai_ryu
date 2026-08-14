"use client";

import { Button, buttonVariants } from "@ryu/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card";
import { Input } from "@ryu/ui/components/input";
import { NumberTicker } from "@ryu/ui/components/number-ticker";
import {
	PlanBadge,
	type PlanTier,
	planTierConicGradient,
} from "@ryu/ui/components/plan-badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { Tabs, TabsList, TabsTrigger } from "@ryu/ui/components/tabs";
import { cn } from "@ryu/ui/lib/utils";
import {
	ArrowLeft,
	Bot,
	Calendar,
	ChevronDown,
	Cloud,
	Coins,
	Cpu,
	Download,
	Key,
	Loader2,
	Mail,
	Minus,
	Monitor,
	Plus,
	Scale,
	Server,
	Shield,
	Star,
	Users,
	Wrench,
	Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";

export type PricingPlanSlug =
	| "lifetime"
	| "pro-monthly"
	| "pro-yearly"
	| "max-monthly"
	| "max-yearly"
	| "teams-monthly"
	| "teams-yearly"
	// Ryu Cloud hosting tiers, e.g. "cloud-base" / "cloud-2x" / "cloud-3x". The
	// exact ids come from the tier catalog (`@ryu/auth/lib/cloud-tiers`), injected
	// by the page; this stays presentational.
	| `cloud-${string}`;

export type CurrentPricingPlan = "desktop-license" | "pro" | "max" | "teams";

/**
 * Display shape for a Ryu Cloud hosting tier row (injected by the page). Specs +
 * price come from the live Hetzner catalog with a markup, but the USER never sees
 * Hetzner/CX/CPX names — only CPU / RAM / SSD + a perf label. `monthlyAddUsd` is
 * the cost ON TOP of Max (0 for the free BASE node bundled with Max, flagged by
 * `includedWithMax`).
 */
export interface CloudHostingTier {
	readonly cores: number;
	readonly diskGb: number;
	/** Canonical tier id (BASE / 2X / 3X). */
	readonly id: string;
	/** True for the BASE node bundled free with every recurring plan. */
	readonly includedWithMax: boolean;
	readonly memoryGb: number;
	/** Monthly add-on price on top of Max (USD). 0 for the included BASE node. */
	readonly monthlyAddUsd: number;
	readonly name: string;
	/** User-facing performance label ("Cost-optimized" | "Performance"). */
	readonly perfLabel: string;
	/** The checkout slug, e.g. "cloud-2x". BASE has no checkout (bundled with Max). */
	readonly slug: PricingPlanSlug;
}

const noop = () => {
	// presentational default; the live page injects real handlers
};

/* -------------------------------------------------------------------------- *
 * Advertised list prices, in whole USD per month.
 *
 * These MIRROR `PLAN_MONTHLY_PRICE_MICRO_USD` in `@ryu/auth/lib/plans` (the
 * billing source of truth). They are duplicated here — not imported — because
 * `@ryu/blocks` is presentational and must not take a dependency on the auth /
 * control-plane package; the desktop paywall and the storyboard render these
 * same cards without a billing client. Change a price in `plans.ts` and change
 * it here in the same commit.
 * -------------------------------------------------------------------------- */
export const PRO_MONTHLY_USD = 39;
/**
 * Max is $99, charm-priced under $100 on purpose. It was $200 with a $150 credit
 * pool, which made it a credit pack priced ABOVE what the same credits cost as a
 * top-up — see `plans.ts` for the arithmetic. It now differentiates on the
 * machine, the mail limits and the deposit rate.
 */
export const MAX_MONTHLY_USD = 99;
/**
 * Teams is $49/seat — ABOVE Pro, not equal to it. A team seat buys governance,
 * not more inference, which is the market convention (a Cursor Teams seat is
 * double Pro's price for identical included usage). Pricing it at Pro made Teams
 * invisible: same price, smaller pool, and forced on any multi-member org.
 */
export const TEAMS_MONTHLY_PER_SEAT_USD = 49;
/**
 * Seat minimums, mirroring `PLANS.<plan>.seatModel.minSeats`. Same duplication
 * bargain as the prices above: presentational surfaces read these, and the one
 * page that has the catalog on hand may override them via props.
 */
export const TEAMS_MIN_SEATS = 2;
/**
 * Max is SINGLE-SEAT. The constant stays at 1 (and the card shows no seat
 * stepper) because Max used to be seat-scalable, which put two multi-seat
 * business plans side by side differing only in credit volume. Multi-seat is
 * Teams' job.
 */
export const MAX_MIN_SEATS = 1;

/* -------------------------------------------------------------------------- *
 * Included AI usage, in whole USD per month (per SEAT for Teams).
 *
 * Mirrors `PLANS.<plan>.monthlyCreditPoolMicroUsd`, and exists as constants
 * rather than literals because these numbers appear in three places — the plan
 * card bullets, the savings-calculator footnote, and the comparison copy — and
 * the footnote used to DERIVE its figure from a "50% of price" rule. When the
 * pools were pinned per plan that rule stopped being true, and the page quietly
 * advertised $19.50 of included usage on a plan granting $15.
 * -------------------------------------------------------------------------- */
export const PRO_INCLUDED_USD = 15;
export const MAX_INCLUDED_USD = 30;
export const TEAMS_INCLUDED_PER_SEAT_USD = 15;

/**
 * Teams volume discount, mirrored from `@ryu/auth/lib/seat-tiers` for the same
 * reason the prices above are mirrored: `@ryu/blocks` is presentational and must
 * not depend on the control-plane package. Polar enforces the real ladder via
 * native seat tiers; this only renders it.
 */
export const TEAMS_VOLUME_TIERS: readonly {
	minSeats: number;
	percent: number;
}[] = [
	{ minSeats: 10, percent: 5 },
	{ minSeats: 25, percent: 10 },
	{ minSeats: 50, percent: 15 },
];

/**
 * The per-seat price at `seats`, volume discount applied.
 *
 * THIS MUST EXIST, and its absence was a bug: the card rendered the volume
 * ladder as a NOTE while `PriceBlock` still multiplied the LIST seat price by
 * the seat count. At 25 seats the page quoted $1,225/mo against the $1,102.50
 * Polar actually charges — the page overstating by $122.50/mo, which is the same
 * class of page-vs-checkout disagreement as Teams advertising $39 while billing
 * $49. A discount nobody sees until the invoice is worse than no discount.
 *
 * Rounded to whole cents to match `seatPriceUsd` in `@ryu/auth/lib/seat-tiers`,
 * which is what the provisioning script writes into Polar's native seat tiers.
 */
export function teamsSeatPriceUsd(listUsd: number, seats: number): number {
	let percent = 0;
	for (const tier of TEAMS_VOLUME_TIERS) {
		if (seats >= tier.minSeats) {
			percent = tier.percent;
		}
	}
	return Math.round(listUsd * (1 - percent / 100) * 100) / 100;
}

/** The volume discount in force at `seats`, as a percentage (0 when none). */
export function teamsVolumePercent(seats: number): number {
	let percent = 0;
	for (const tier of TEAMS_VOLUME_TIERS) {
		if (seats >= tier.minSeats) {
			percent = tier.percent;
		}
	}
	return percent;
}

/** Annual billing gives two months free (pay for 10 of 12 months). */
const FREE_MONTHS_ON_ANNUAL = 2;
const MONTHS_PER_YEAR = 12;
/** Paid months in an annual term, once the two free months are taken off. */
const PAID_MONTHS_ON_ANNUAL = MONTHS_PER_YEAR - FREE_MONTHS_ON_ANNUAL;

/**
 * The billed monthly figure a recurring plan advertises. On the yearly toggle
 * this is the per-month *equivalent* of the annual price (two months free, i.e.
 * billed for 10 of 12 months); on monthly it is the list price. Anchoring on the
 * smaller monthly number is the standard SaaS psychology play. With monthly
 * $39/$99 this lands the annual totals on $390/$990 (Pro/Max), matching the
 * Polar yearly prices.
 */
export function effectiveMonthlyPrice(
	monthly: number,
	isYearly: boolean
): number {
	return isYearly
		? Math.round((monthly * PAID_MONTHS_ON_ANNUAL) / MONTHS_PER_YEAR)
		: monthly;
}

/** The true annual total for a plan billed yearly (two months free). */
export function annualTotalPrice(monthly: number): number {
	return monthly * PAID_MONTHS_ON_ANNUAL;
}

/** US-dollar formatter for whole-dollar totals ("$1,170"). */
const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});

/**
 * The price block for a recurring plan. Always shows the *monthly* figure with a
 * "/mo" suffix (see {@link effectiveMonthlyPrice}), with the true annual total
 * spelled out beneath.
 *
 * The headline is always the PER-PERSON price — the number the plan is
 * advertised at — so the comparison across cards stays apples-to-apples; the
 * multiplied total for the chosen seat count is spelled out underneath so the
 * buyer still sees what they will actually pay. `perSeat` only controls the
 * "/seat" suffix (Teams is advertised per seat; Max is advertised at a flat
 * $99/mo), and is independent of `seats`.
 */
function PriceBlock({
	monthly,
	isYearly,
	perSeat = false,
	seats = 1,
}: {
	monthly: number;
	isYearly: boolean;
	perSeat?: boolean;
	seats?: number;
}) {
	const annualTotal = annualTotalPrice(monthly);
	const perMonth = effectiveMonthlyPrice(monthly, isYearly);
	const seat = perSeat ? "/seat" : "";
	// Only more than one seat has a total worth spelling out; at one seat the
	// total IS the headline.
	const showSeatTotal = seats > 1;
	const seatTotal = perMonth * seats;
	const seatAnnualTotal = annualTotal * seats;
	return (
		<>
			<div className="mb-1 flex items-baseline">
				<NumberTicker
					className="font-semibold text-4xl"
					prefix="$"
					value={perMonth}
				/>
				<span className="ml-1 text-muted-foreground">{`${seat}/mo`}</span>
			</div>
			{/* The seat total and the annual total spin like the headline rather
			    than snapping. They move for the SAME reasons it does — the yearly
			    toggle and the seat stepper — so a static number beside a spinning
			    one reads as the static one having failed to update. */}
			{showSeatTotal ? (
				<p className="mb-1 flex items-baseline font-medium text-sm">
					<NumberTicker prefix="$" value={seatTotal} />
					<span className="ml-1">/mo for {seats} seats</span>
				</p>
			) : null}
			{isYearly ? (
				<p className="mb-6 flex items-baseline text-muted-foreground text-xs">
					<span className="mr-1">Billed</span>
					<NumberTicker
						prefix="$"
						value={showSeatTotal ? seatAnnualTotal : annualTotal}
					/>
					<span className="ml-1">
						{showSeatTotal ? "" : seat}/year · 2 months free
					</span>
				</p>
			) : (
				<p className="mb-6 text-muted-foreground text-xs">
					{`Billed monthly${perSeat ? " · per seat" : ""} · cancel anytime`}
				</p>
			)}
		</>
	);
}

/**
 * Seat count control for the per-seat plans (Teams, and Max — which is
 * seat-scalable from one seat). A minus/plus stepper around a numeric input,
 * clamped to `[minSeats, MAX_SEAT_SELECTOR]`; anything larger is an Enterprise
 * conversation, so the copy points there rather than letting the field run away.
 *
 * Presentational and CONTROLLED: it renders only when the host passes an
 * `onSeatsChange`, so surfaces that show the cards read-only (the desktop
 * paywall, storyboard) are unaffected.
 */
/**
 * Where self-serve stops and sales starts.
 *
 * 100 because that is the same line `docs/enterprise-pricing-framework.md` draws:
 * above it a buyer almost always needs something self-serve cannot do anyway —
 * SSO, invoicing and a PO, a security review, custom terms — so letting the
 * slider run to 500 sold a purchase that procurement would have blocked at
 * checkout. It was 500, which disagreed with the framework and quoted six-figure
 * annual commitments through a card form with no contract behind them.
 *
 * The cap is a ROUTING decision, not a limit on how many seats we will sell: the
 * copy beside it points at Enterprise, which is where 100+ is priced properly
 * (and more cheaply per seat than this ladder bottoms out at).
 *
 * MIRRORS `SELF_SERVE_MAX_SEATS` in `@ryu/auth/lib/seat-tiers`, which is where
 * it is ENFORCED — both `/checkout/teams` and `validateSeatChange` refuse above
 * it. This constant only stops the slider; a cap that lived only here would be a
 * suggestion, since both routes read a seat count straight off the request body.
 */
const MAX_SEAT_SELECTOR = 100;

function SeatSelector({
	seats,
	minSeats,
	onSeatsChange,
	inputId,
}: {
	seats: number;
	minSeats: number;
	onSeatsChange: (seats: number) => void;
	inputId: string;
}) {
	const clamp = (next: number) =>
		Math.min(MAX_SEAT_SELECTOR, Math.max(minSeats, Math.floor(next)));
	// The seat count SPINS like every other figure on the card, but the field
	// must stay typeable — a 250-seat buyer is not pressing "+" 248 times. So the
	// ticker is what you see, and clicking it swaps in the real input.
	const [editing, setEditing] = useState(false);

	return (
		<div className="mb-6">
			<label
				className="mb-2 block font-medium text-muted-foreground text-xs"
				htmlFor={inputId}
			>
				Seats
			</label>
			<div className="flex items-center gap-3">
				{/* ONE control, not three. The stepper buttons live INSIDE the field's
				    border and share its height, so it reads as a single seat picker
				    rather than a text box that happens to have buttons parked beside
				    it. `lg` sizing because this is the only interactive control on the
				    card and it competes with a 4xl price. */}
				<div className="inline-flex h-11 items-center rounded-lg border bg-background shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50">
					<button
						aria-label="Remove a seat"
						className="flex h-full w-10 shrink-0 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						disabled={seats <= minSeats}
						onClick={() => onSeatsChange(clamp(seats - 1))}
						type="button"
					>
						<Minus className="size-4" />
					</button>
					<Input
						// Borderless and transparent: the WRAPPER owns the border now, so
						// the input keeping its own would draw a box inside a box. The
						// appearance triple removes the native spinners, which would
						// otherwise duplicate the buttons either side of them.
						className={cn(
							"h-full w-14 border-0 bg-transparent px-0 text-center font-medium text-base tabular-nums shadow-none focus-visible:ring-0",
							"[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
							editing ? "" : "sr-only"
						)}
						id={inputId}
						inputMode="numeric"
						max={MAX_SEAT_SELECTOR}
						min={minSeats}
						onBlur={() => setEditing(false)}
						onChange={(event) => {
							const next = Number.parseInt(event.target.value, 10);
							if (Number.isFinite(next)) {
								onSeatsChange(clamp(next));
							}
						}}
						type="number"
						value={seats}
					/>
					{editing ? null : (
						<button
							aria-label={`${seats} seats — click to type a different number`}
							className="flex h-full w-14 items-center justify-center font-medium text-base tabular-nums"
							onClick={() => setEditing(true)}
							type="button"
						>
							<NumberTicker value={seats} />
						</button>
					)}
					<button
						aria-label="Add a seat"
						className="flex h-full w-10 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						disabled={seats >= MAX_SEAT_SELECTOR}
						onClick={() => onSeatsChange(clamp(seats + 1))}
						type="button"
					>
						<Plus className="size-4" />
					</button>
				</div>
				<span className="text-muted-foreground text-xs">
					{seats >= MAX_SEAT_SELECTOR
						? "Need more? Talk to sales"
						: minSeats > 1
							? `minimum ${minSeats}`
							: "1 seat = 1 person"}
				</span>
			</div>
		</div>
	);
}

/**
 * Who the plans on screen are for. The pricing page splits on this BEFORE the
 * billing period, because the two audiences do not shop the same shelf: an
 * individual comparing Lifetime against Pro should never have to read past two
 * seat-priced business plans to find them.
 */
export type PricingAudience = "business" | "individual";

/** Which plans each audience sees, and in which order. */
export const PRICING_AUDIENCE_PLANS = {
	business: ["teams", "max", "enterprise"],
	individual: ["lifetime", "pro"],
} as const;

/** Where the customer runs Ryu — the outermost pricing choice. */
export type PricingDeployment = "platform" | "self-hosted";

/**
 * THE DEPLOYMENT SWITCH — platform vs self-hosted.
 *
 * DELIBERATELY NOT A THIRD PILL ROW. The page already carries two `TabsList`
 * pill switches (audience, then billing), and adding a third identical row makes
 * three controls that LOOK like peers while being nested: deployment decides
 * whether billing is even a concept, audience narrows the shelf inside it, and
 * billing only restyles what is already visible. Three equal pill rows stacked
 * on top of each other flatten that hierarchy into a wall of tabs, and the
 * reader has to try them to learn which one matters.
 *
 * So this one is rendered as a segmented CARD control — bigger, captioned, its
 * own surface — and the two pill rows below it are hidden entirely on the
 * self-hosted side (there is no seat billing to toggle and no audience split).
 * The result is at most two visible controls at any time, in a visual order that
 * matches the logical one, rather than four.
 */
export function PricingDeploymentToggle({
	deployment = "platform",
	onDeploymentChange = noop,
}: {
	deployment?: PricingDeployment;
	onDeploymentChange?: (deployment: PricingDeployment) => void;
}) {
	const OPTIONS: {
		caption: string;
		icon: typeof Cloud;
		label: string;
		value: PricingDeployment;
	}[] = [
		{
			caption: "We run it. Credits included, no keys to hold.",
			icon: Cloud,
			label: "Ryu Platform",
			value: "platform",
		},
		{
			caption: "You run it. Open source, on your own infrastructure.",
			icon: Server,
			label: "Self-hosted",
			value: "self-hosted",
		},
	];
	return (
		<div className="mx-auto mb-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
			{OPTIONS.map((option) => {
				const active = deployment === option.value;
				const Icon = option.icon;
				return (
					<button
						aria-pressed={active}
						className={cn(
							"rounded-2xl border p-4 text-left transition-colors",
							active
								? "border-primary bg-primary/5"
								: "border-border bg-card hover:bg-accent/40"
						)}
						key={option.value}
						onClick={() => onDeploymentChange(option.value)}
						type="button"
					>
						<span className="flex items-center gap-2 font-semibold text-sm">
							<Icon
								className={cn(
									"size-4",
									active ? "text-primary" : "text-muted-foreground"
								)}
							/>
							{option.label}
						</span>
						<span className="mt-1 block text-muted-foreground text-xs">
							{option.caption}
						</span>
					</button>
				);
			})}
		</div>
	);
}

/**
 * The individual / business audience switch. Sits ABOVE the monthly/yearly
 * toggle: it changes WHICH plans exist, where the billing toggle only changes
 * how the visible ones are billed, so the wider choice is the outer one.
 *
 * Both this and the billing toggle live INSIDE the platform branch — see
 * {@link PricingDeploymentToggle} for why they are hidden rather than disabled
 * on the self-hosted side.
 */
export function PricingAudienceToggle({
	audience = "individual",
	onAudienceChange = noop,
}: {
	audience?: PricingAudience;
	onAudienceChange?: (audience: PricingAudience) => void;
}) {
	return (
		<div className="mb-4 flex justify-center">
			<Tabs
				onValueChange={(val) => onAudienceChange(val as PricingAudience)}
				value={audience}
			>
				<TabsList variant="pills-lg">
					<TabsTrigger value="individual">Individual</TabsTrigger>
					<TabsTrigger value="business">Business &amp; Enterprise</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
	);
}

/** The monthly/yearly billing period toggle. */
export function PricingBillingToggle({
	isYearly = false,
	onToggleYearly = noop,
}: {
	isYearly?: boolean;
	onToggleYearly?: (yearly: boolean) => void;
}) {
	return (
		<div className="mb-8 flex justify-center">
			<Tabs
				onValueChange={(val) => onToggleYearly(val === "yearly")}
				value={isYearly ? "yearly" : "monthly"}
			>
				<TabsList variant="pills">
					<TabsTrigger value="monthly">Monthly</TabsTrigger>
					<TabsTrigger
						className="[&_span]:text-primary data-active:[&_span]:text-white/90 dark:data-active:[&_span]:text-black/80"
						value="yearly"
					>
						Yearly
						<span className="ml-1.5 font-medium text-xs">2 months free</span>
					</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
	);
}

/**
 * Apple-style expandable "add hosted compute" panel, nested inside a plan card
 * (Max and Teams). Collapsed by default; expands to reveal the Ryu Cloud
 * hosting ladder. The BASE node ships free with the plan (shown as "Included",
 * never a checkout); the 2X/3X performance tiers are paid add-ons priced on top
 * of the plan, each with its own checkout (separate monthly billing — the merge
 * is purely visual). Renders nothing when no tiers are supplied. `planLabel`
 * names the host plan in the copy.
 */
function CloudUpgradePanel({
	tiers,
	loadingPlan,
	onCheckout,
	planLabel,
}: {
	tiers: readonly CloudHostingTier[];
	loadingPlan: PricingPlanSlug | null;
	onCheckout: (slug: PricingPlanSlug) => void;
	planLabel: string;
}) {
	const [expanded, setExpanded] = useState(false);

	if (tiers.length === 0) {
		return null;
	}

	return (
		<div className="mt-6 border-t pt-4">
			<button
				aria-expanded={expanded}
				className="flex w-full items-center justify-between gap-2 text-left font-medium text-sm"
				onClick={() => setExpanded((prev) => !prev)}
				type="button"
			>
				<span className="flex items-center gap-2">
					<Server className="size-4" />
					Run your AI in the cloud
				</span>
				<ChevronDown
					className={
						expanded
							? "size-4 rotate-180 transition-transform"
							: "size-4 transition-transform"
					}
				/>
			</button>
			<p className="mt-1 text-muted-foreground text-xs">
				Your {planLabel} plan includes a free managed node, so your AI keeps
				running 24/7 even when your computer is off. Upgrade for more
				performance — billed monthly, on top of {planLabel}.
			</p>
			<AnimatePresence initial={false}>
				{expanded ? (
					<motion.ul
						animate={{ height: "auto", opacity: 1 }}
						className="overflow-hidden"
						exit={{ height: 0, opacity: 0 }}
						initial={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.24, ease: "easeOut" }}
					>
						{tiers.map((tier) => {
							const specs = `${tier.cores} vCPU · ${tier.memoryGb} GB RAM · ${tier.diskGb} GB SSD`;
							// BASE ships free with the plan: shown, never a checkout.
							if (tier.includedWithMax) {
								return (
									<li key={tier.slug}>
										<div className="mt-3 flex w-full items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-left">
											<Cloud className="size-4 shrink-0 text-primary" />
											<span className="flex-1">
												<span className="block font-medium text-sm">
													{tier.name} · {tier.perfLabel}
												</span>
												<span className="block text-muted-foreground text-xs">
													{specs}
												</span>
											</span>
											<span className="shrink-0 font-semibold text-primary text-sm">
												Included
											</span>
										</div>
									</li>
								);
							}
							const isLoading = loadingPlan === tier.slug;
							return (
								<li key={tier.slug}>
									<button
										className="mt-3 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary disabled:opacity-60"
										disabled={isLoading}
										onClick={() => onCheckout(tier.slug)}
										type="button"
									>
										<Cpu className="size-4 shrink-0 text-primary" />
										<span className="flex-1">
											<span className="block font-medium text-sm">
												{tier.name} · {tier.perfLabel}
											</span>
											<span className="block text-muted-foreground text-xs">
												{specs}
											</span>
										</span>
										<span className="shrink-0 text-right">
											{isLoading ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<span className="font-semibold text-sm">
													+${tier.monthlyAddUsd}
													<span className="text-muted-foreground text-xs">
														/mo
													</span>
												</span>
											)}
										</span>
									</button>
								</li>
							);
						})}
					</motion.ul>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/**
 * Wraps a plan card in a 2px gradient border. Pro uses an always-on animated
 * conic sweep (`.t-pro-card-border`); other tiers (max/teams/lifetime) show a
 * static default border in the 2px frame in LIGHT mode only (`bg-border`;
 * `dark:bg-transparent` = borderless in dark) that MORPHS into a matching
 * animated conic ring on hover (`.t-card-border-spin` +
 * {@link planTierConicGradient}).
 */
function PricingCardBorder({
	variant,
	children,
}: {
	variant: PlanTier;
	children: ReactNode;
}) {
	if (variant === "pro") {
		return (
			<div className="t-pro-card-border relative rounded-[calc(var(--radius-4xl)+2px)] p-[2px]">
				<Card className="relative flex h-full flex-col border-transparent">
					{children}
				</Card>
			</div>
		);
	}

	return (
		<div className="group relative rounded-[calc(var(--radius-4xl)+2px)] bg-border p-[2px] dark:bg-transparent">
			<div
				aria-hidden
				className="t-card-border-spin pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
				style={{ backgroundImage: planTierConicGradient(variant) }}
			/>
			<Card className="relative flex h-full flex-col border-transparent">
				{children}
			</Card>
		</div>
	);
}

/** Shared props every individual plan card accepts. */
interface PlanCardProps {
	currentPlan?: CurrentPricingPlan | null;
	isYearly?: boolean;
	loadingPlan?: PricingPlanSlug | null;
	onCheckout?: (slug: PricingPlanSlug) => void;
}

/**
 * Extra props a SEAT-BASED plan card accepts (Teams, Max). `minSeats` mirrors
 * the plan catalog's `seatModel.minSeats` and is injected by the page — the
 * blocks package is presentational and deliberately does not depend on
 * `@ryu/auth`. The seat stepper renders only when `onSeatsChange` is supplied,
 * so read-only surfaces keep their current single-seat rendering.
 */
interface SeatPlanCardProps extends PlanCardProps {
	cloudTiers?: readonly CloudHostingTier[];
	minSeats?: number;
	onSeatsChange?: (seats: number) => void;
	seats?: number;
}

/** The footer CTA shared by every plan card (current / processing / label). */
function PlanCta({
	isCurrent,
	isLoading,
	label,
	onClick,
	variant,
}: {
	isCurrent: boolean;
	isLoading: boolean;
	label: string;
	onClick: () => void;
	variant?: "outline";
}) {
	return (
		<Button
			className="w-full"
			disabled={isCurrent || isLoading}
			onClick={onClick}
			variant={variant}
		>
			{isCurrent ? (
				"Current plan"
			) : isLoading ? (
				<>
					<Loader2 className="mr-2 size-4 animate-spin" />
					Processing…
				</>
			) : (
				label
			)}
		</Button>
	);
}

/** Lifetime (desktop license) plan card — one-time purchase, local-first. */
export function LifetimePlanCard({
	loadingPlan = null,
	onCheckout = noop,
	currentPlan = null,
}: PlanCardProps) {
	const isCurrent = currentPlan === "desktop-license";
	return (
		<PricingCardBorder variant="desktop-license">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Lifetime Access
					<PlanBadge label="Lifetime" plan="desktop-license" size="md" />
				</CardTitle>
				<CardDescription>
					Run AI on your own computer. Pay once.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				<div className="mb-1 flex items-baseline gap-2">
					<NumberTicker
						className="font-semibold text-4xl"
						prefix="$"
						value={29}
					/>
					<span className="text-muted-foreground text-xl line-through">
						$69
					</span>
					<span className="ml-1 text-muted-foreground">once</span>
				</div>
				<p className="mb-6 font-medium text-primary text-xs">
					Launch price · save 58%
				</p>
				<ul className="space-y-3">
					<li className="flex items-center">
						<Monitor className="mr-2 size-4" />
						<span>Run AI on your own computer, forever</span>
					</li>
					<li className="flex items-center">
						<Key className="mr-2 size-4" />
						<span>Use your own keys for cloud AI (optional)</span>
					</li>
					<li className="flex items-center">
						<Wrench className="mr-2 size-4" />
						<span>Private: nothing leaves your machine</span>
					</li>
					<li className="flex items-center">
						<Calendar className="mr-2 size-4" />
						<span>One year of updates included</span>
					</li>
					<li className="flex items-center">
						<Star className="mr-2 size-4" />
						<span>7-day free trial, no card needed</span>
					</li>
				</ul>
			</CardContent>
			<CardFooter>
				<PlanCta
					isCurrent={isCurrent}
					isLoading={loadingPlan === "lifetime"}
					label="Get lifetime access"
					onClick={() => onCheckout("lifetime")}
					variant="outline"
				/>
			</CardFooter>
		</PricingCardBorder>
	);
}

/** Pro plan card — the highlighted managed plan (animated gradient border). */
export function ProPlanCard({
	isYearly = false,
	loadingPlan = null,
	onCheckout = noop,
	currentPlan = null,
}: PlanCardProps) {
	const isCurrent = currentPlan === "pro";
	const isLoading =
		loadingPlan === "pro-monthly" || loadingPlan === "pro-yearly";

	return (
		<PricingCardBorder variant="pro">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Pro Plan
					<PlanBadge plan="pro" size="md" />
				</CardTitle>
				<CardDescription>We run AI for you. Nothing to set up.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				<PriceBlock isYearly={isYearly} monthly={PRO_MONTHLY_USD} />
				<ul className="space-y-3">
					<li className="flex items-center">
						<Download className="mr-2 size-4" />
						<span>The full app on all your devices</span>
					</li>
					<li className="flex items-center">
						<Bot className="mr-2 size-4" />
						<span>Unlimited chats, agents & spaces</span>
					</li>
					<li className="flex items-center">
						<Cloud className="mr-2 size-4" />
						<span>300+ cloud AI models, ready to use</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4" />
						<span>{`$${PRO_INCLUDED_USD}/month of AI usage included`}</span>
					</li>
					<li className="flex items-center">
						<Zap className="mr-2 size-4" />
						<span>We handle all the setup for you</span>
					</li>
					<li className="flex items-center">
						<Monitor className="mr-2 size-4" />
						<span>Run AI on your computer too</span>
					</li>
					<li className="flex items-center">
						<Mail className="mr-2 size-4" />
						<span>
							Unlimited Agent Inboxes &amp; emails · 5 GB mail storage
						</span>
					</li>
					<li className="flex items-center">
						<Server className="mr-2 size-4" />
						<span>Space data limited only by your disk</span>
					</li>
					{/* The free base node ships with EVERY recurring plan (Pro, Max and
					    Teams — `planIncludesBaseNode` in @ryu/auth/lib/base-node is the
					    enforced predicate). This bullet and the entitlement must move
					    together: advertising it without the gate 402s the buyer, and
					    widening the gate without the bullet gives away compute nobody
					    was told about. */}
					<li className="flex items-center">
						<Cloud className="mr-2 size-4" />
						<span>Free managed cloud node (2 vCPU · 4 GB)</span>
					</li>
					<li className="flex items-center">
						<Key className="mr-2 size-4" />
						<span>Use your own API keys (optional)</span>
					</li>
				</ul>
			</CardContent>
			<CardFooter>
				<PlanCta
					isCurrent={isCurrent}
					isLoading={isLoading}
					label="Upgrade"
					onClick={() => onCheckout(isYearly ? "pro-yearly" : "pro-monthly")}
				/>
			</CardFooter>
		</PricingCardBorder>
	);
}

/**
 * Max plan card — the individual power tier, with the optional Cloud panel.
 *
 * NO SEAT STEPPER: Max is single-seat now. It was seat-scalable, and that is
 * precisely what made the ladder unreadable — a buyer comparing two multi-seat
 * plans had to do arithmetic to discover the cheaper one was also the better
 * one. Teams owns multi-seat.
 *
 * The bullets lead with what a TOP-UP CANNOT BUY (machine, mail, deposit rate),
 * because the credit line alone no longer justifies the jump and pretending
 * otherwise is how the old $200 tier became unsellable.
 */
export function MaxPlanCard({
	isYearly = false,
	loadingPlan = null,
	onCheckout = noop,
	currentPlan = null,
	cloudTiers = [],
}: SeatPlanCardProps) {
	const isCurrent = currentPlan === "max";
	const isLoading =
		loadingPlan === "max-monthly" || loadingPlan === "max-yearly";
	// `seats` / `minSeats` / `onSeatsChange` are accepted and IGNORED rather than
	// removed from the prop type: the page still passes them, and dropping them
	// from the signature would break the call site for a card that simply has no
	// seat dimension any more. They are inert here on purpose.
	return (
		<PricingCardBorder variant="max">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Max Plan
					<PlanBadge plan="max" size="md" />
				</CardTitle>
				<CardDescription>We run AI for you, around the clock.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				<PriceBlock isYearly={isYearly} monthly={MAX_MONTHLY_USD} />
				<ul className="space-y-3">
					<li className="flex items-center">
						<ArrowLeft className="mr-2 size-4" />
						<span>Everything in Pro, plus:</span>
					</li>
					<li className="flex items-center">
						<Server className="mr-2 size-4" />
						<span>
							<strong>Double the cloud node</strong> — 4 vCPU · 8 GB · 80 GB
						</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4" />
						<span>
							<strong>Cheaper top-ups</strong> — 12% deposit fee, not 13%
						</span>
					</li>
					<li className="flex items-center">
						<Bot className="mr-2 size-4" />
						<span>AI agents that keep working 24/7</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4" />
						<span>{`$${MAX_INCLUDED_USD}/month of AI usage included`}</span>
					</li>
					<li className="flex items-center">
						<Mail className="mr-2 size-4" />
						<span>Unlimited Agent Inboxes · 10 GB storage</span>
					</li>
					<li className="flex items-center">
						<Shield className="mr-2 size-4" />
						<span>Priority support</span>
					</li>
				</ul>
				<CloudUpgradePanel
					loadingPlan={loadingPlan}
					onCheckout={onCheckout}
					planLabel="Max"
					tiers={cloudTiers}
				/>
			</CardContent>
			<CardFooter>
				<PlanCta
					isCurrent={isCurrent}
					isLoading={isLoading}
					label="Upgrade"
					onClick={() => onCheckout(isYearly ? "max-yearly" : "max-monthly")}
				/>
			</CardFooter>
		</PricingCardBorder>
	);
}

/**
 * Shown once a volume tier is actually EARNED: the list price struck through,
 * and the percentage named.
 *
 * Separate from {@link VolumeDiscountNote}, which advertises the ladder to
 * someone who has not reached it yet. Both matter, and for opposite reasons —
 * one is a reason to add seats, the other is confirmation you got what you were
 * promised. A discount applied silently is indistinguishable from no discount.
 */
function VolumeDiscountApplied({ seats }: { seats: number }) {
	const percent = teamsVolumePercent(seats);
	if (percent === 0) {
		return null;
	}
	return (
		<p className="mb-4 font-medium text-primary text-sm">
			<span className="text-muted-foreground line-through">
				${TEAMS_MONTHLY_PER_SEAT_USD}
			</span>{" "}
			{percent}% volume discount applied at {seats} seats
		</p>
	);
}

/**
 * The volume ladder, rendered as a plain line of breakpoints.
 *
 * It is on the card rather than in a footnote because it is the answer to the
 * objection the old pricing had none for: a growing company paid strictly more
 * per head as it grew, with no relief and no reason to consolidate. Showing the
 * next breakpoint to a buyer sitting at 8 seats is the point.
 */
function VolumeDiscountNote() {
	return (
		<p className="mt-4 text-muted-foreground text-xs">
			Volume pricing:{" "}
			{TEAMS_VOLUME_TIERS.map((tier, i) => (
				<span key={tier.minSeats}>
					{i > 0 ? " · " : ""}
					<strong>{tier.percent}% off</strong> from {tier.minSeats} seats
				</span>
			))}
		</p>
	);
}

/**
 * Teams plan card — per-seat org plan, with the optional Cloud panel.
 *
 * The card leads with the GOVERNANCE premium, not a price match. Teams used to
 * be priced at Pro and led with "at the same price per person", which read as
 * "nothing changes" — and the entitlements agreed, since the per-seat pool was
 * actually smaller than Pro's. A team seat costs more because it buys shared
 * billing, roles, more mail and a node per 10 seats.
 */
export function TeamsPlanCard({
	isYearly = false,
	loadingPlan = null,
	onCheckout = noop,
	currentPlan = null,
	cloudTiers = [],
	seats = TEAMS_MIN_SEATS,
	minSeats = TEAMS_MIN_SEATS,
	onSeatsChange,
}: SeatPlanCardProps) {
	const isCurrent = currentPlan === "teams";
	const isLoading =
		loadingPlan === "teams-monthly" || loadingPlan === "teams-yearly";
	const effectiveSeats = Math.max(seats, minSeats);
	return (
		<PricingCardBorder variant="teams">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Teams
					<PlanBadge plan="teams" size="md" />
				</CardTitle>
				<CardDescription>We run AI for your whole team.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				{/* The DISCOUNTED per-seat price, not the list — Polar bills the
				    volume tier, so quoting list here would overstate the bill. */}
				<PriceBlock
					isYearly={isYearly}
					monthly={teamsSeatPriceUsd(
						TEAMS_MONTHLY_PER_SEAT_USD,
						effectiveSeats
					)}
					perSeat
					seats={effectiveSeats}
				/>
				<VolumeDiscountApplied seats={effectiveSeats} />
				{onSeatsChange ? (
					<SeatSelector
						inputId="ryu-seats-teams"
						minSeats={minSeats}
						onSeatsChange={onSeatsChange}
						seats={effectiveSeats}
					/>
				) : null}
				<ul className="space-y-3">
					<li className="flex items-center">
						<ArrowLeft className="mr-2 size-4" />
						<span>Everything in Pro, for the whole org:</span>
					</li>
					<li className="flex items-center">
						<Users className="mr-2 size-4" />
						<span>One bill, one shared wallet</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4" />
						<span>{`$${TEAMS_INCLUDED_PER_SEAT_USD}/seat/month of AI usage, pooled`}</span>
					</li>
					<li className="flex items-center">
						<Shield className="mr-2 size-4" />
						<span>Roles &amp; permissions</span>
					</li>
					<li className="flex items-center">
						<Wrench className="mr-2 size-4" />
						<span>Manage seats &amp; spending</span>
					</li>
					<li className="flex items-center">
						<Mail className="mr-2 size-4" />
						<span>Unlimited Agent Inboxes · 20 GB storage</span>
					</li>
					{/* Teams is the ONE plan whose compute grows with the org — by SIZE
					    first, then count (`TEAMS_NODE_TIERS` in @ryu/auth/lib/base-node).
					    Ten small boxes for a hundred people would be ten small boxes. */}
					<li className="flex items-center">
						<Server className="mr-2 size-4" />
						<span>
							<strong>A free cloud node that grows with your team</strong> — up
							to 4 vCPU · 8 GB
						</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4" />
						<span>12% deposit fee on top-ups</span>
					</li>
				</ul>
				<VolumeDiscountNote />
				<CloudUpgradePanel
					loadingPlan={loadingPlan}
					onCheckout={onCheckout}
					planLabel="Teams"
					tiers={cloudTiers}
				/>
				<p className="mt-4 text-muted-foreground text-xs">
					Minimum {minSeats} seats
				</p>
			</CardContent>
			<CardFooter>
				<PlanCta
					isCurrent={isCurrent}
					isLoading={isLoading}
					label="Upgrade"
					onClick={() =>
						onCheckout(isYearly ? "teams-yearly" : "teams-monthly")
					}
					variant="outline"
				/>
			</CardFooter>
		</PricingCardBorder>
	);
}

/**
 * Enterprise plan — the "contact sales" tier, now a CARD beside Teams rather
 * than a full-width band below it.
 *
 * It was a band because the business shelf used to hold Teams AND Max, so a
 * third card would not fit. Max moved to the individual shelf when it became
 * single-seat, which left Teams alone on a two-column grid with a hole in it —
 * and a band under a lone card reads as a footnote rather than as a tier.
 *
 * As a card it also does its OTHER job properly: an unpriced option beside a
 * priced one is the anchor that makes the priced one look definite. "Custom"
 * carries no number to compare against, so it can only raise the reference
 * point.
 *
 * No self-serve checkout — the CTA goes to sales.
 */
export function EnterprisePlanCard() {
	return (
		<PricingCardBorder variant="enterprise">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Enterprise
					<PlanBadge label="Enterprise" plan="enterprise" size="md" />
				</CardTitle>
				<CardDescription>
					We run AI across your whole organization.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				{/* No NumberTicker here on purpose: "Custom" is not a number, and the
				    absence of one is the point of the tier. */}
				<div className="mb-1 font-semibold text-4xl">Custom</div>
				<p className="mb-6 text-muted-foreground text-xs">
					Tailored to your org · annual contract
				</p>
				<ul className="space-y-3">
					<li className="flex items-center">
						<ArrowLeft className="mr-2 size-4" />
						<span>Everything in Teams, plus:</span>
					</li>
					<li className="flex items-center">
						<Key className="mr-2 size-4" />
						<span>SSO &amp; SCIM provisioning</span>
					</li>
					<li className="flex items-center">
						<Shield className="mr-2 size-4" />
						<span>Audit logs, custom SLA &amp; DPA</span>
					</li>
					<li className="flex items-center">
						<Server className="mr-2 size-4" />
						<span>Dedicated or self-hosted deployment</span>
					</li>
					<li className="flex items-center">
						<Cloud className="mr-2 size-4" />
						<span>Choose your data region</span>
					</li>
					<li className="flex items-center">
						<Users className="mr-2 size-4" />
						<span>Named contact &amp; onboarding</span>
					</li>
					<li className="flex items-center">
						<Wrench className="mr-2 size-4" />
						<span>Invoicing, PO &amp; custom terms</span>
					</li>
				</ul>
			</CardContent>
			<CardFooter>
				<a
					className={buttonVariants({
						variant: "outline",
						className: "w-full",
					})}
					href="/contact"
				>
					Contact sales
				</a>
			</CardFooter>
		</PricingCardBorder>
	);
}

/**
 * THE LICENCE COPY ON THESE TWO CARDS IS LOAD-BEARING — do not simplify it to
 * "open source" or to a single licence name.
 *
 * Ryu is open-CORE, not uniformly permissive, and the split is exactly what the
 * paid tier sells relief from (`docs/open-core.md` is the source of truth):
 *
 *  - `apps/core` and the SDK/CLI are **Apache-2.0** — permissive, no obligations.
 *  - `apps/gateway` and `crates/gateway/*` are **AGPL-3.0** — and the gateway is
 *    the piece a company actually deploys for routing, firewall, PII/DLP,
 *    budgets and audit. AGPL's network clause means an org that MODIFIES the
 *    gateway and offers it over a network owes those modifications back.
 *  - The desktop, web and identity surfaces are proprietary and are not part of
 *    a self-hosted deployment at all.
 *
 * That AGPL boundary is the commercial-licence lever, and it is a stronger offer
 * than "we'll support you": the paid tier sells an actual alternative licence to
 * an actual obligation. Writing "Apache 2.0 licensed" across the whole product
 * (which is what a competitor with a uniformly-permissive core can truthfully
 * say) would be FALSE here, and a wrong licence claim on a public pricing page is
 * the most expensive error this file can carry.
 *
 * No price is quoted for the licensed tier. There is no per-annum figure to
 * quote — `docs/enterprise-pricing-framework.md` prices contracts case by case.
 */
export function SelfHostedOssCard() {
	return (
		<PricingCardBorder variant="desktop-license">
			<CardHeader>
				<CardTitle className="text-xl">Open source</CardTitle>
				<CardDescription>
					Run the whole engine on your own machines.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				<div className="mb-1 font-semibold text-4xl">$0</div>
				<p className="mb-6 text-muted-foreground text-xs">
					Free forever · self-supported
				</p>
				<ul className="space-y-3">
					<li className="flex items-center">
						<Scale className="mr-2 size-4 shrink-0" />
						<span>Apache-2.0 core · AGPL-3.0 gateway</span>
					</li>
					<li className="flex items-center">
						<Bot className="mr-2 size-4 shrink-0" />
						<span>Agents, workflows, memory &amp; tools</span>
					</li>
					<li className="flex items-center">
						<Shield className="mr-2 size-4 shrink-0" />
						<span>Gateway routing, firewall &amp; budgets</span>
					</li>
					<li className="flex items-center">
						<Key className="mr-2 size-4 shrink-0" />
						<span>Your own provider keys</span>
					</li>
					<li className="flex items-center">
						<Server className="mr-2 size-4 shrink-0" />
						<span>Zero egress — nothing leaves your network</span>
					</li>
					<li className="flex items-center">
						<Users className="mr-2 size-4 shrink-0" />
						<span>Community support</span>
					</li>
				</ul>
			</CardContent>
			<CardFooter>
				<a
					className={buttonVariants({
						variant: "outline",
						className: "w-full",
					})}
					href="https://docs.ryuhq.com/docs/start-here/getting-started/self-host"
				>
					Read the self-hosting guide
				</a>
			</CardFooter>
		</PricingCardBorder>
	);
}

/** The commercial licence: AGPL relief, plus the controls an enterprise needs. */
export function SelfHostedLicensedCard() {
	return (
		<PricingCardBorder variant="enterprise">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-xl">
					Licensed
					<PlanBadge label="Enterprise" plan="enterprise" size="md" />
				</CardTitle>
				<CardDescription>
					A commercial licence, on your infrastructure.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-1">
				<div className="mb-1 font-semibold text-4xl">Custom</div>
				<p className="mb-6 text-muted-foreground text-xs">
					Flat annual fee · no per-seat or per-token metering
				</p>
				<ul className="space-y-3">
					<li className="flex items-center">
						<ArrowLeft className="mr-2 size-4 shrink-0" />
						<span>Everything in open source, plus:</span>
					</li>
					<li className="flex items-center">
						<Scale className="mr-2 size-4 shrink-0" />
						<span>Commercial licence — no AGPL obligations</span>
					</li>
					<li className="flex items-center">
						<Key className="mr-2 size-4 shrink-0" />
						<span>SSO &amp; SCIM provisioning</span>
					</li>
					<li className="flex items-center">
						<Shield className="mr-2 size-4 shrink-0" />
						<span>Audit logs, custom SLA &amp; DPA</span>
					</li>
					<li className="flex items-center">
						<Cpu className="mr-2 size-4 shrink-0" />
						<span>Air-gapped &amp; offline deployment</span>
					</li>
					<li className="flex items-center">
						<Wrench className="mr-2 size-4 shrink-0" />
						<span>Named support engineer &amp; onboarding</span>
					</li>
					<li className="flex items-center">
						<Coins className="mr-2 size-4 shrink-0" />
						<span>Invoicing, PO &amp; custom terms</span>
					</li>
				</ul>
			</CardContent>
			<CardFooter>
				<a className={buttonVariants({ className: "w-full" })} href="/contact">
					Talk to us
				</a>
			</CardFooter>
		</PricingCardBorder>
	);
}

/**
 * The self-hosted shelf: two cards, free OSS and the commercial licence.
 *
 * Two columns for two cards, matching the platform shelf's rule that column
 * count tracks card count — a wider grid holding two cards reads as a page that
 * failed to load.
 */
export function SelfHostedPlanGrid() {
	return (
		<div className="mx-auto mb-12 grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
			<SelfHostedOssCard />
			<SelfHostedLicensedCard />
		</div>
	);
}

/**
 * The pricing plans, presentational: the self-serve plans for one AUDIENCE in a
 * grid, with the Enterprise "contact sales" tier as a full-width band below on
 * the business shelf. Cloud hosting is NOT here — it lives in the org dashboard
 * (post-auth).
 *
 * The grid is two columns on both shelves, not four. Column count has to track
 * the card count: a `lg:grid-cols-4` holding two cards renders them at quarter
 * width with half the row empty, which reads as a page that failed to load
 * rather than as a deliberate two-plan shelf.
 */
export function PricingPlanGrid({
	audience = "individual",
	isYearly = false,
	loadingPlan = null,
	onCheckout = noop,
	currentPlan = null,
	seats,
	onSeatsChange,
	maxSeats,
	onMaxSeatsChange,
	teamsMinSeats = TEAMS_MIN_SEATS,
	maxMinSeats = MAX_MIN_SEATS,
}: {
	/** Which shelf to render — see {@link PRICING_AUDIENCE_PLANS}. */
	audience?: PricingAudience;
	isYearly?: boolean;
	loadingPlan?: PricingPlanSlug | null;
	/** Seat minimum for Max, from `PLANS.max.seatModel`. */
	maxMinSeats?: number;
	/**
	 * Max's seat count, tracked SEPARATELY from `seats`. Max scales from one seat
	 * and is advertised at a flat monthly price, so seeding it from the Teams
	 * minimum would open the page showing the flagship plan at two seats.
	 */
	maxSeats?: number;
	onCheckout?: (slug: PricingPlanSlug) => void;
	/** Supply to turn on Max's seat stepper. */
	onMaxSeatsChange?: (seats: number) => void;
	/** Supply to turn on the Teams seat stepper. */
	onSeatsChange?: (seats: number) => void;
	currentPlan?: CurrentPricingPlan | null;
	/** The Teams seat count; ignored when `onSeatsChange` is absent. */
	seats?: number;
	/** Seat minimum for Teams, from `PLANS.teams.seatModel`. */
	teamsMinSeats?: number;
}) {
	if (audience === "individual") {
		return (
			// THREE cards, Lifetime -> Pro -> Max, ascending. Max moved here from the
			// business shelf when it became single-seat: it is an individual power
			// tier, and sitting it beside Teams was the visual half of the same
			// mistake the catalog made — two plans presented as alternatives when one
			// is bought per person and the other per org.
			//
			// Three is also the shape that reads best: the centre card carries the
			// eye, the third sets the high anchor, and a fourth would flatten both.
			<div className="mx-auto mb-12 grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-3">
				<LifetimePlanCard
					currentPlan={currentPlan}
					isYearly={isYearly}
					loadingPlan={loadingPlan}
					onCheckout={onCheckout}
				/>
				<ProPlanCard
					currentPlan={currentPlan}
					isYearly={isYearly}
					loadingPlan={loadingPlan}
					onCheckout={onCheckout}
				/>
				<MaxPlanCard
					currentPlan={currentPlan}
					isYearly={isYearly}
					loadingPlan={loadingPlan}
					minSeats={maxMinSeats}
					onCheckout={onCheckout}
					onSeatsChange={onMaxSeatsChange}
					seats={maxSeats ?? maxMinSeats}
				/>
			</div>
		);
	}

	return (
		<>
			{/* TWO cards: the self-serve org plan and the one you have to call about.
			    Enterprise lives ONLY on this shelf — on the individual shelf it would
			    advertise "contact sales" to someone buying one seat. */}
			<div className="mx-auto mb-12 grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
				<TeamsPlanCard
					currentPlan={currentPlan}
					isYearly={isYearly}
					loadingPlan={loadingPlan}
					minSeats={teamsMinSeats}
					onCheckout={onCheckout}
					onSeatsChange={onSeatsChange}
					seats={seats ?? teamsMinSeats}
				/>
				<EnterprisePlanCard />
			</div>
		</>
	);
}

/**
 * A single selectable Ryu Cloud instance, priced from the LIVE Hetzner catalog
 * (specs + live $/mo × markup), injected by the page. The USER never sees the
 * underlying Hetzner type name — only CPU / RAM / SSD + a perf label + price.
 * `type` is the opaque checkout key (passed back on select), never rendered.
 */
export interface PricingCloudInstance {
	/** True in the currently selected location. */
	readonly availableInLocation: boolean;
	readonly cores: number;
	readonly diskGb: number;
	/** True for the free base node bundled with Max (shown as "Included"). */
	readonly includedWithMax: boolean;
	readonly memoryGb: number;
	/** Customer-facing monthly USD (live × markup); 0 for the included base. */
	readonly monthlyUsd: number;
	/** User-facing perf class label ("Cost-optimized" | "Performance" | "ARM"). */
	readonly perfLabel: string;
	/** Opaque Hetzner type key — the checkout argument, NEVER displayed. */
	readonly type: string;
}

/** A selectable Hetzner location, shown to the user as city + country. */
export interface PricingCloudLocation {
	readonly city: string;
	readonly country: string;
	readonly id: string;
}

/**
 * Ryu Cloud dynamic instance picker — managed nodes (Core + Gateway hosted for
 * you). Reads a live catalog (specs + live $/mo × markup + regional
 * availability) injected by the page; the user picks a location and a node.
 * The base node ships free with every recurring plan (shown "Included with
 * your plan", never a
 * checkout); every other node is an ad-hoc cloud-instance subscription. The USER
 * only ever sees CPU / RAM / SSD + a perf label + price — never the Hetzner type
 * name. Presentational: the page fetches the catalog and wires the handlers.
 *
 * Cloud instances are billed monthly regardless of the plan monthly/yearly
 * toggle above (that toggle only applies to the subscription plans), so this
 * never reads `isYearly`.
 */
export function PricingInstancePicker({
	instances = [],
	locations = [],
	location = "",
	live = true,
	loadingType = null,
	onLocationChange = noop,
	onSelectInstance = noop,
}: {
	instances?: readonly PricingCloudInstance[];
	live?: boolean;
	loadingType?: string | null;
	location?: string;
	locations?: readonly PricingCloudLocation[];
	onLocationChange?: (locationId: string) => void;
	onSelectInstance?: (type: string) => void;
}) {
	if (instances.length === 0) {
		return null;
	}
	return (
		<div className="mx-auto mb-12 max-w-7xl">
			<div className="mb-6 text-center">
				<h2 className="flex items-center justify-center gap-2 font-semibold text-2xl">
					<Server className="size-5" />
					Ryu Cloud
				</h2>
				<p className="mt-1 text-muted-foreground">
					We host your node: Core, Gateway, and 24/7 agents. Your Max plan
					includes a free base node; add a bigger node whenever you need more
					performance.
				</p>
				<p className="mt-1 text-muted-foreground text-xs">
					Nodes are billed monthly at live cost. The yearly toggle doesn&apos;t
					apply to Cloud nodes.
				</p>
			</div>
			{locations.length > 0 ? (
				<div className="mb-6 flex items-center justify-center gap-2">
					<label
						className="text-muted-foreground text-sm"
						htmlFor="ryu-cloud-location"
					>
						Region
					</label>
					<Select
						items={locations.map((loc) => ({
							label: `${loc.city}, ${loc.country}`,
							value: loc.id,
						}))}
						// The Select can emit `null` when cleared; there is no
						// "no location" state to report, so that case is ignored.
						onValueChange={(value) => {
							if (value !== null) {
								onLocationChange(value);
							}
						}}
						value={location}
					>
						<SelectTrigger className="w-56" id="ryu-cloud-location">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{locations.map((loc) => (
								<SelectItem key={loc.id} value={loc.id}>
									{loc.city}, {loc.country}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
			<div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{instances.map((instance) => {
					const isIncluded = instance.includedWithMax;
					const isLoading = loadingType === instance.type;
					const unavailable = !(isIncluded || instance.availableInLocation);
					return (
						<Card
							className={
								isIncluded
									? "relative flex flex-col border-primary"
									: "relative flex flex-col"
							}
							key={instance.type}
						>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-xl">
									{isIncluded ? (
										<Cloud className="size-4 text-primary" />
									) : (
										<Cpu className="size-4 text-primary" />
									)}
									{instance.perfLabel}
								</CardTitle>
								<CardDescription>
									{instance.cores} vCPU · {instance.memoryGb} GB RAM
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1">
								{isIncluded ? (
									<div className="mb-6 flex items-baseline">
										<span className="font-semibold text-4xl">Included</span>
										<span className="ml-2 text-muted-foreground">with Max</span>
									</div>
								) : (
									<div className="mb-6 flex items-baseline">
										<NumberTicker
											className="font-semibold text-4xl"
											prefix="$"
											value={instance.monthlyUsd}
										/>
										<span className="ml-1 text-muted-foreground">/mo</span>
									</div>
								)}
								<ul className="space-y-3">
									<li className="flex items-center">
										<Cpu className="mr-2 size-4" />
										<span>{instance.cores} vCPU</span>
									</li>
									<li className="flex items-center">
										<Server className="mr-2 size-4" />
										<span>{instance.memoryGb} GB RAM</span>
									</li>
									<li className="flex items-center">
										<Cloud className="mr-2 size-4" />
										<span>{instance.diskGb} GB SSD</span>
									</li>
								</ul>
							</CardContent>
							<CardFooter>
								{isIncluded ? (
									<Button className="w-full" disabled variant="outline">
										Included with your plan
									</Button>
								) : (
									<Button
										className="w-full"
										disabled={isLoading || unavailable}
										onClick={() => onSelectInstance(instance.type)}
									>
										{isLoading ? (
											<>
												<Loader2 className="mr-2 size-4 animate-spin" />
												Processing…
											</>
										) : unavailable ? (
											"Not in this region"
										) : (
											"Deploy node"
										)}
									</Button>
								)}
							</CardFooter>
						</Card>
					);
				})}
			</div>
			<p className="mt-4 text-center text-muted-foreground text-xs">
				{live
					? "Prices track live compute cost."
					: "Estimated pricing — live catalog unavailable."}{" "}
				Self-hostable too: run `infra/provision.sh` against your own cloud
				account.
			</p>
		</div>
	);
}
