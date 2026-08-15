// Gesture physics — the seam between a drag and the animation that follows it.
//
// A drag that ends by snapping from the *release position* throws away everything
// the user just told us. Two gestures that finish on the same pixel, one flicked
// and one crawled, should not produce the same result. These helpers carry the
// gesture's velocity across that seam.
//
//   const track = createVelocityTracker();
//   // on each pointermove:   track.sample(e.clientX, e.timeStamp)
//   // on pointerup:          const v = track.velocity()          // px/s
//   //                        const landed = projectEndpoint(x, v) // where a flick lands
//
// WHAT DOES NOT BELONG HERE: resizers. macOS split dividers and window edges have
// no inertia — you place a divider, you do not throw it. `projectEndpoint` is for
// things that fly free (drag-to-dismiss, snap carousels, flick-to-collapse), and
// `rubberband` is a scroll affordance. Applying either to a plain resize gutter
// reads as broken, not fluid.

/** How long a sample stays relevant. Older points describe a different gesture. */
const VELOCITY_WINDOW_MS = 100;

/** Two samples is the minimum for a slope; keep a few so one stutter cannot skew it. */
const MAX_SAMPLES = 6;

/**
 * Scroll-style exponential decay. 0.998 is the normal iOS feel; 0.99 is snappier.
 * This is the form Apple ships in the Designing Fluid Interfaces sample code —
 * NOT the physics-textbook `v^2 / (2 * deceleration)`.
 */
const DEFAULT_DECELERATION_RATE = 0.998;

const MS_PER_SECOND = 1000;

/** Default resistance for {@link rubberband}; matches UIScrollView's feel. */
const DEFAULT_RUBBERBAND_CONSTANT = 0.55;

interface Sample {
	time: number;
	value: number;
}

export interface VelocityTracker {
	/** Forget every sample — call when a gesture begins, not when it ends. */
	reset: () => void;
	/** Record a position at a timestamp. Pass `event.timeStamp`, not `Date.now()`. */
	sample: (value: number, time: number) => void;
	/** Signed velocity in units/second over the recent window. 0 if undeterminable. */
	velocity: () => number;
}

/**
 * Tracks a short position history so a gesture's release velocity can be measured.
 *
 * Velocity comes from the oldest sample still inside {@link VELOCITY_WINDOW_MS},
 * not from the last two points: consecutive pointermove events can be sub-millisecond
 * apart, and dividing by that noise produces wild spikes.
 */
export function createVelocityTracker(): VelocityTracker {
	let samples: Sample[] = [];

	return {
		sample(value: number, time: number) {
			samples.push({ value, time });
			// Drop anything outside the window, then cap the buffer.
			const cutoff = time - VELOCITY_WINDOW_MS;
			samples = samples.filter((s) => s.time >= cutoff).slice(-MAX_SAMPLES);
		},

		velocity() {
			if (samples.length < 2) {
				return 0;
			}
			const first = samples[0];
			const last = samples.at(-1);
			if (!(first && last)) {
				return 0;
			}
			const elapsed = last.time - first.time;
			if (elapsed <= 0) {
				return 0;
			}
			return ((last.value - first.value) / elapsed) * MS_PER_SECOND;
		},

		reset() {
			samples = [];
		},
	};
}

/**
 * Where a flick would come to rest, given its release velocity.
 *
 * Snap to the target nearest THIS point rather than the one nearest the release
 * position — that is what makes a flick feel like it throws the element.
 *
 * @param current   position at release
 * @param velocity  release velocity in units/second (from {@link VelocityTracker})
 */
export function projectEndpoint(
	current: number,
	velocity: number,
	decelerationRate: number = DEFAULT_DECELERATION_RATE
): number {
	return (
		current +
		((velocity / MS_PER_SECOND) * decelerationRate) / (1 - decelerationRate)
	);
}

/**
 * Progressive resistance past a boundary — the further out, the less it follows.
 *
 * A hard stop reads as frozen; continuous resistance reads as responsive but empty.
 * Returns the *displayed* overshoot for a raw one, always smaller in magnitude and
 * asymptotically bounded.
 *
 * @param overshoot  how far past the bound the pointer actually is (signed)
 * @param dimension  the size of the axis being dragged, which sets the scale
 */
export function rubberband(
	overshoot: number,
	dimension: number,
	constant: number = DEFAULT_RUBBERBAND_CONSTANT
): number {
	if (dimension <= 0) {
		return 0;
	}
	return (
		(overshoot * dimension * constant) /
		(dimension + constant * Math.abs(overshoot))
	);
}

/**
 * Clamp with give: inside the bounds this is a plain passthrough, outside it is
 * {@link rubberband} resistance measured from the bound that was crossed.
 */
export function clampWithRubberband(
	value: number,
	min: number,
	max: number,
	dimension: number,
	constant: number = DEFAULT_RUBBERBAND_CONSTANT
): number {
	if (value < min) {
		return min + rubberband(value - min, dimension, constant);
	}
	if (value > max) {
		return max + rubberband(value - max, dimension, constant);
	}
	return value;
}
