// The shared "level ladder" fill ramp — the colour every stepped level slider
// paints its track with, so the composer's reasoning-effort picker, Appearance →
// Detail level and the account menu's Interface level all read as one control
// with three jobs instead of three controls that happen to look similar.
//
// It ramps green → orange → red → purple across whatever levels the caller
// advertises, so the top detent is always the top of the ramp regardless of how
// many detents there are. Three of the four stops are theme tokens, so a
// customized theme (packages/ui/src/theme/apply.ts rewrites
// --success/--warning/--destructive) carries them, and all three brighten in
// dark mode. The top stop has no semantic token to borrow — the set is
// success/warning/destructive/info — so it is declared as a class the use site
// puts on an ancestor, with a dark value that brightens alongside the other
// three. A single literal would leave the hottest end reading DARKER than red on
// a dark track.
//
// IMPORTANT: `levelFillColor` returns a `color-mix()` that references
// `--effort-top`. That variable exists ONLY where {@link LEVEL_RAMP_CLASS} is
// applied, so any new slider must put that class on itself or an ancestor —
// otherwise the whole `color-mix` is invalid and the fill silently disappears at
// the hot end. Nothing type-checks that pairing; it is why they live in one
// module.

/** Declares `--effort-top`; required on an ancestor of any ramped slider. */
export const LEVEL_RAMP_CLASS =
	"[--effort-top:oklch(0.6_0.21_305)] dark:[--effort-top:oklch(0.72_0.19_305)]";

const LEVEL_RAMP = [
	"var(--success)",
	"var(--warning)",
	"var(--destructive)",
	"var(--effort-top)",
] as const;

/** Fraction of the ramp colour left in the fill; the rest is track showing through. */
const FILL_STRENGTH = 55;

/**
 * The fill colour for the level at `index` of `count`.
 *
 * Index 0 is deliberately NOT given a stop of its own: at the minimum the fill
 * has zero width, so its colour is never seen (for Pi's effort ladder that index
 * is `off`, for Detail level it is `None`). Spreading the ramp over the levels
 * that actually paint — 1..count-1 — is what makes a five-level ladder land on
 * green · orange · red · purple instead of pushing every named colour inward and
 * only ever showing purple.
 */
export function levelFillColor(index: number, count: number): string {
	const last = LEVEL_RAMP.length - 1;
	const visible = count - 1;
	const raw = visible > 1 ? ((index - 1) / (visible - 1)) * last : last;
	// Index 0 lands below the ramp; clamp rather than extrapolate, or the mix
	// percentage goes negative and the whole colour is dropped as invalid.
	const t = Math.min(Math.max(raw, 0), last);
	const lo = Math.min(Math.floor(t), last - 1);
	const frac = Math.round((t - lo) * 100);
	const stop =
		frac === 0
			? LEVEL_RAMP[lo]
			: `color-mix(in oklab, ${LEVEL_RAMP[lo + 1]} ${frac}%, ${LEVEL_RAMP[lo]})`;
	return `color-mix(in oklab, ${stop} ${FILL_STRENGTH}%, transparent)`;
}
