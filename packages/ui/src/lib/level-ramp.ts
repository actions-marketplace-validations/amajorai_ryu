// The shared cool → hot fill ramp for stepped level controls. The composer
// effort picker and the hosted-node picker both use it so a stepped choice reads
// the same way across the product.

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
 * Index 0 is deliberately not given a visible stop of its own: at the minimum
 * the fill has zero width. Spreading the ramp over the levels that paint keeps
 * the named colours evenly distributed for any number of detents.
 */
export function levelFillColor(index: number, count: number): string {
	const last = LEVEL_RAMP.length - 1;
	const visible = count - 1;
	const raw = visible > 1 ? ((index - 1) / (visible - 1)) * last : last;
	const t = Math.min(Math.max(raw, 0), last);
	const lo = Math.min(Math.floor(t), last - 1);
	const frac = Math.round((t - lo) * 100);
	const stop =
		frac === 0
			? LEVEL_RAMP[lo]
			: `color-mix(in oklab, ${LEVEL_RAMP[lo + 1]} ${frac}%, ${LEVEL_RAMP[lo]})`;
	return `color-mix(in oklab, ${stop} ${FILL_STRENGTH}%, transparent)`;
}
