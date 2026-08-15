// Easing curves and named spring configs.
//
// VOCABULARY. Apple describes a spring with two designer-facing numbers rather
// than the physics triplet: a DAMPING RATIO (overshoot; 1.0 lands exactly, below
// 1.0 bounces) and a RESPONSE (how quickly it reaches the target). `springs.ts`
// speaks that language directly and is the preferred module for new motion —
// reach for `spring.fast` / `.moderate` / `.slow` there first.
//
// The configs below stay in stiffness/damping/mass because Motion's `useSpring`
// takes that form, but every one of them now DECLARES its damping ratio and lets
// `damped()` derive the damping constant. That is the whole point: reading
// `stiffness: 420, damping: 40` tells you nothing about whether it overshoots,
// and it is where two of these tokens had silently drifted overdamped —
// SPRING_PANEL sat at ζ ≈ 1.38 and SPRING_GLIDE at ζ ≈ 1.34, so the largest,
// most-noticed surfaces in the app crawled into place instead of landing.
//
// Never hand-write `stiffness`/`damping` at a call site. Add a token here.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Critically damped: lands exactly on target with no overshoot. The default for
 * anything that did not arrive carrying a gesture's momentum.
 */
const CRITICAL = 1;

/**
 * Damping constant for a given damping ratio: `c = ζ · 2√(k·m)`.
 *
 * ζ = 1 is critical damping — the fastest settle with no overshoot. Below 1 the
 * spring overshoots and oscillates (right when a flick or drag preceded it, wrong
 * for something that merely appeared). Above 1 it is overdamped: no bounce, but a
 * long creeping tail that reads as lag rather than precision.
 */
const damped = (stiffness: number, mass: number, ratio: number): number =>
	Math.round(ratio * 2 * Math.sqrt(stiffness * mass));

/**
 * Press feedback on buttons and other tappable surfaces.
 * ζ 0.87 — deliberately just under critical: a release carries the momentum of
 * the press, so a touch of overshoot is earned here.
 */
export const SPRING_PRESS = {
	type: "spring",
	stiffness: 500,
	damping: damped(500, 0.6, 0.87),
	mass: 0.6,
} as const;

/**
 * Content swaps — label/icon slots trading places inside a control.
 * ζ 1.0 — nothing was thrown, so it must not bounce.
 */
export const SPRING_SWAP = {
	type: "spring",
	stiffness: 460,
	damping: damped(460, 0.55, CRITICAL),
	mass: 0.55,
} as const;

/**
 * Overlay panel entrances — modals and sheets summoned by pointer.
 * ζ 1.0 (was 1.38, overdamped: it drifted to a stop instead of landing).
 */
export const SPRING_PANEL = {
	type: "spring",
	stiffness: 420,
	damping: damped(420, 0.5, CRITICAL),
	mass: 0.5,
} as const;

/**
 * Shared-layout glides — pills, indicators and panels morphing between positions.
 * ζ 1.0 (was 1.09).
 */
export const SPRING_LAYOUT = {
	type: "spring",
	stiffness: 360,
	damping: damped(360, 0.6, CRITICAL),
	mass: 0.6,
} as const;

/**
 * Shell morphs — a container resizing between two content states (a popover
 * growing out of its launcher, a nav section swapping width).
 * ζ 1.0 — the shell must land exactly, since its edge is the thing being read.
 * The heavier mass is what separates this from SPRING_LAYOUT: deliberate rather
 * than snappy, because the whole surface is moving.
 */
export const SPRING_MORPH = {
	type: "spring",
	stiffness: 320,
	damping: damped(320, 0.9, CRITICAL),
	mass: 0.9,
} as const;

/**
 * Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock).
 * ζ 0.97 — a hair loose on purpose, so the follow trails the pointer softly.
 */
export const SPRING_MOUSE = {
	stiffness: 200,
	damping: damped(200, 0.3, 0.97),
	mass: 0.3,
} as const;

/**
 * Dragged handles and fills (sliders) — the value follows the pointer and must
 * never rebound off an end stop.
 * ζ 1.0 (was 1.34, overdamped — the comment already claimed critical damping;
 * now the number agrees with it).
 */
export const SPRING_GLIDE = {
	stiffness: 700,
	damping: damped(700, 0.5, CRITICAL),
	mass: 0.5,
} as const;
