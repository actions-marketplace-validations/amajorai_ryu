"use client";

import { Logo } from "./logo.tsx";
import {
	PassCardShell,
	type PassEdge,
	useIsDarkFace,
	WARP_BASE_DARK,
	WARP_BASE_LIGHT,
} from "./pass-card-shell.tsx";
import { type PlanTier, planTierColors, planTierLabel } from "./plan-badge.tsx";
import { AutoFitText, FIT_STEP_PX } from "./waitlist-pass.tsx";

/**
 * The pass a PAID member holds — the same laminated, two-sided, metal-ringed
 * object as the waitlist pass, printed in their tier's own colours.
 *
 * The tier enters through the BACKDROP, not through the type: the warp shader
 * behind the face is fed `planTierColors(plan)`, which is the very stop list
 * inside the plan badge's gradient. So the card's field is the badge a reader
 * already knows from the sidebar, in motion, and there is still exactly one
 * source of tier colour. Body type stays on `text-card-foreground` — the
 * badge's own `ink` is calibrated for an opaque gradient plinth and is
 * unreadable under a 30–55% shader wash.
 *
 * Presentational and side-effect free, like `waitlist-pass.tsx`: it takes an
 * already-resolved plan and an already-formatted date and renders them. It is
 * the live counterpart of `pass-studio`'s tier painter, and the two are kept in
 * step by the ramp constants below rather than by anyone remembering to.
 */

/**
 * The tier label's type ramp. The ceiling is the `text-5xl` (48px) the pass
 * family's hero line has always been set in; the floor is where "Enterprise" —
 * the longest label, and the only one that reaches for it — stops out-ranking
 * the holder name beneath it. Every other label clears the ceiling outright.
 */
export const TIER_LABEL_MAX_PX = 48;
export const TIER_LABEL_MIN_PX = 26;
/**
 * The holder line's ramp. A subtitle, so it starts small and has less room to
 * give — but a real name can be long, and a name is never ours to truncate, so
 * it shrinks on the same measured rule before it is allowed to wrap.
 */
export const TIER_HOLDER_MAX_PX = 18;
export const TIER_HOLDER_MIN_PX = 12;
/**
 * The footer fields. Both sizes are constants applied as inline `fontSize`
 * rather than one constant and one Tailwind class, because `pass-studio`'s tier
 * painter reproduces this footer from these numbers — a size that lived only in
 * a class would leave the painter guessing, which is the exact drift
 * `paint.ts`'s "no independent constants" rule exists to stop.
 */
export const TIER_STAT_VALUE_PX = 20;
export const TIER_META_PX = 12;
/** Re-exported, not re-declared: one ramp step across every pass face. */
export const TIER_FIT_STEP_PX = FIT_STEP_PX;

/**
 * The warp stops for a tier: the badge palette laid against the scheme's own
 * base tone at both ends.
 *
 * The base is interleaved rather than the palette being used raw because a
 * fully saturated field eats the type printed on it — the shader is a texture
 * UNDER the card's content, which is the same reason `WARP_OPACITY_*` exist.
 * Bracketing keeps the darkest (or lightest) point of the flow at the seam
 * where the gradient wraps, so the field breathes instead of strobing.
 *
 * Nine stops at the widest (`pro`), against the shader's ceiling of ten, so
 * every tier passes through unreduced.
 */
export function tierWarpColors(plan: PlanTier, isDark: boolean): string[] {
	const base = isDark ? WARP_BASE_DARK : WARP_BASE_LIGHT;
	return [base, ...planTierColors(plan), base];
}

/**
 * A stable, meaningless seed. `PassCardShell` still requires `ditherSeed`, but
 * on a tier card `warpColors` overrides the only thing the seed would have
 * coloured, so it is inert — this exists so the value passed is at least not a
 * lie about what the card is, and is stable across renders (a fresh seed each
 * render would rehash the backdrop for nothing).
 */
export function tierPassSeed(plan: PlanTier, holder?: string | null): string {
	return `${plan}:${holder?.trim() || "ryu"}`;
}

export interface TierPassProps {
	className?: string;
	/**
	 * {@link PassEdge}. `"live"` for the one hero card on a screen; the default
	 * brushed ramp for anything that appears more than once, since `"live"`
	 * costs a metal-fx instance per plane of the milled edge.
	 */
	edge?: PassEdge;
	/** Name printed on the card. Falsy → the card reads as an unpersonalised specimen. */
	holder?: string | null;
	/**
	 * Which tuning of the metal ring to paint, and the scheme the warp's base
	 * tone is picked from. `"auto"` follows `prefers-color-scheme`, which is
	 * wrong wherever the app has a manual theme toggle that can disagree with the
	 * OS — callers pass their resolved theme. Kept as a prop rather than read
	 * from `next-themes` here so the UI package stays consumer-agnostic.
	 */
	metalTheme?: "auto" | "dark" | "light";
	plan: PlanTier;
	/** Already-formatted date, e.g. "Aug 2026". The card prints it verbatim. */
	since?: string | null;
	/**
	 * Kill the card's self-motion — the idle turn, the float, and the
	 * drag-to-rotate. Mandatory anywhere another gesture reads the same pointer
	 * (the cut-to-cancel dialog), since `still` is also what returns
	 * `touch-action` to the page.
	 */
	still?: boolean;
}

/**
 * One labelled fact in the footer: value above its label, sentence case, the
 * same treatment the waitlist pass gives its position readout. The number (or
 * word) is what is worth reading; the label only says which fact it is.
 */
function TierStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span
				className="truncate font-medium leading-none"
				style={{ fontSize: `${TIER_STAT_VALUE_PX}px` }}
			>
				{value}
			</span>
			<span
				className="truncate text-muted-foreground"
				style={{ fontSize: `${TIER_META_PX}px` }}
			>
				{label}
			</span>
		</div>
	);
}

export function TierPass({
	className,
	edge = "brushed",
	holder,
	metalTheme = "auto",
	plan,
	since,
	still = false,
}: TierPassProps) {
	// Resolved HERE and handed down, rather than each consumer reading the
	// scheme for itself: `useIsDarkFace` subscribes, so the card repaints when
	// the OS toggle flips instead of holding a palette sampled once at mount.
	const isDark = useIsDarkFace(metalTheme);
	const label = planTierLabel(plan);
	const name = holder?.trim() ?? "";

	return (
		<PassCardShell
			backdrop="warp"
			className={className}
			ditherSeed={tierPassSeed(plan, holder)}
			edge={edge}
			metalTheme={metalTheme}
			// `ringed` is left at its default of on. The waitlist pass withholds the
			// chrome edge until a handle is claimed, because there the ring is what
			// the reserve step pays out; a paid tier has nothing left to earn, so it
			// arrives as a finished object.
			still={still}
			warpColors={tierWarpColors(plan, isDark)}
		>
			<div className="relative flex min-h-[27rem] w-full flex-1 flex-col gap-6 p-7">
				{/* Wordmark alone. The waitlist card puts its join date opposite the
				    lockup; here that date is a LABELLED field in the footer, and
				    printing the same fact twice unlabelled on a 320px card reads as a
				    layout that lost track of itself. */}
				<div className="flex items-center gap-2">
					<Logo size="20px" variant="outline" />
					<span className="font-medium text-sm">Ryu</span>
				</div>

				<div className="flex min-w-0 flex-1 flex-col justify-end gap-1.5">
					<AutoFitText
						className="font-semibold leading-[1.02] tracking-tight"
						maxPx={TIER_LABEL_MAX_PX}
						minPx={TIER_LABEL_MIN_PX}
						stepPx={TIER_FIT_STEP_PX}
					>
						{label}
					</AutoFitText>
					{/* No placeholder for a missing holder. An empty-state line under
					    the hero reads as a defect on a card whose whole job is to look
					    like a finished object — without a name the card is simply a
					    specimen of the tier, which is exactly what a pricing surface
					    wants to show. */}
					{name ? (
						<AutoFitText
							className="text-muted-foreground"
							maxPx={TIER_HOLDER_MAX_PX}
							minPx={TIER_HOLDER_MIN_PX}
							stepPx={TIER_FIT_STEP_PX}
						>
							{name}
						</AutoFitText>
					) : null}
				</div>

				{/* The card's two facts as labelled fields. "Plan" prints the bare
				    label rather than the fuller "Ryu Enterprise": each column is about
				    124px at the card's own width, which the longer form overruns into
				    an ellipsis — and an elided plan name on the card that certifies the
				    plan is worse than saying the hero word twice. */}
				<div className="grid grid-cols-2 gap-3">
					<TierStat label="Plan" value={label} />
					<TierStat label="Member since" value={since?.trim() || "—"} />
				</div>
			</div>
		</PassCardShell>
	);
}
