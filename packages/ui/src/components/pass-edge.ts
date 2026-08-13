/**
 * The card's MILLED EDGE — its thickness, and the material that thickness is
 * made of.
 *
 * This lives in its own module, apart from `pass-card-shell.tsx`, for two
 * reasons that are both scar tissue:
 *
 * 1. THERE ARE TWO PAINTERS. The live card extrudes its thickness as a stack of
 *    DOM slices (`CardExtrusion`); the pass studio re-draws the same card to a
 *    canvas for stills and the shareable loop (`pass-studio/scene.ts`). Each one
 *    used to carry its own copy of the metal ramp, and when the ramp was retuned
 *    only the DOM copy moved — so the exported card kept the exact look the
 *    retune existed to kill. One exported source, consumed by both.
 * 2. IT IS PURE, SO IT CAN BE TESTED. `pass-card-shell.tsx` pulls in `motion`,
 *    `metal-fx` and a WebGL shader; nothing in it can be reached from
 *    `bun test`. The edge's whole appearance is arithmetic over numbers and
 *    colour strings, and the regressions it keeps suffering are all visible in
 *    that arithmetic — see `pass-edge.test.ts`, which asserts the two properties
 *    that have now failed twice.
 *
 * The failure this file exists to prevent, both times, was the same report: the
 * card reads as TWO cards stacked and joined at the waist rather than as one
 * thick one.
 */

/**
 * Card thickness. Two faces alone turn edge-on into a hairline — a sheet of
 * paper, not a card — so the pass is built as a solid: the faces sit half a
 * thickness apart along Z, and the gap between them is filled.
 *
 * Kept deliberately shallow. Each face carries its own metal ring, so at any
 * real depth you see BOTH rings at once, separated by the gap — which reads as
 * two cards stacked rather than as one thick one. A few pixels is enough to kill
 * the paper-thin look without opening that gap.
 */
export const CARD_THICKNESS_PX = 6;
export const CARD_HALF_THICKNESS_PX = CARD_THICKNESS_PX / 2;

/**
 * Spacing between slices, in px of depth.
 *
 * HALF a pixel, not one. At one-per-pixel the stack spanned z ∈ {2,1,0,−1,−2}
 * against faces sitting at ±3, so a full pixel of the card's thickness was
 * EMPTY on each side — edge-on you saw the page through a hairline gap between
 * the material and each face, which is the first half of "it looks like two
 * cards back to back". Half-pixel steps let the stack run to ±2.5 and leave a
 * sub-pixel gap the compositor blends away, without putting a slice in the
 * exact plane of a face (see {@link sliceDepths}).
 */
export const CARD_SLICE_STEP_PX = 0.5;
/** Depth of the outermost slice: as close to a face as it can get without touching. */
export const CARD_OUTER_SLICE_PX = CARD_HALF_THICKNESS_PX - CARD_SLICE_STEP_PX;
export const CARD_SLICES =
	Math.round(CARD_OUTER_SLICE_PX / CARD_SLICE_STEP_PX) * 2 + 1;

/**
 * Where each slice of the thickness sits along Z, front-most first.
 *
 * STRICTLY BETWEEN the faces. The outermost slices used to sit at
 * ±`CARD_HALF_THICKNESS_PX`, i.e. in the exact plane of each face, and they are
 * opaque across the whole box — including the transparent gutter the metal ring
 * paints into. Coplanar opaque geometry inside a `preserve-3d` context has no
 * defined winner, so which one you saw depended on the turn angle: the FRONT
 * ring lost and only the back one showed, and a back-facing metal-fx instance is
 * not repainted, so the ring that did show was a frozen frame. Hence "the border
 * is only on the back, and it does not animate".
 */
export function sliceDepths(): number[] {
	return Array.from(
		{ length: CARD_SLICES },
		(_, index) => CARD_OUTER_SLICE_PX - index * CARD_SLICE_STEP_PX
	);
}

/** One stop of the lengthwise brushed ramp. `at` is a percentage, 0–100. */
export interface EdgeMetalStop {
	at: number;
	color: string;
}

/**
 * The material the card is milled from, as seen edge-on — the sheen ALONG the
 * card's length. A flat token fill read as cardboard, so the slices carry a
 * brushed-metal ramp instead. Fixed greys rather than theme tokens, because
 * metal is metal in both schemes; the same reason the ring's own presets are not
 * token-derived.
 *
 * ONE specular sweep, deliberately: bright in the upper third and falling away
 * from there. The ramp this replaced was symmetric — bright at 34%, DARK at 52%,
 * bright again at 70% — which put a grey band across the exact middle of the
 * edge and made one card read as two stacked and joined at the waist. A rolled
 * edge is lit by one light; it does not have two highlights with a shadow
 * between them. `pass-edge.test.ts` asserts that single-peak shape, because a
 * comment saying so is exactly what was in place when it regressed.
 */
export const EDGE_METAL_STOPS: readonly EdgeMetalStop[] = [
	{ at: 0, color: "#55555f" },
	{ at: 9, color: "#9a9aa6" },
	{ at: 24, color: "#d6d6df" },
	{ at: 39, color: "#f6f6fa" },
	{ at: 58, color: "#dededf" },
	{ at: 76, color: "#b4b4c0" },
	{ at: 90, color: "#8a8a96" },
	{ at: 100, color: "#5b5b65" },
];

/** {@link EDGE_METAL_STOPS} as a CSS gradient, top-to-bottom. */
export const EDGE_METAL = `linear-gradient(180deg, ${EDGE_METAL_STOPS.map(
	(stop) => `${stop.color} ${stop.at}%`
).join(", ")})`;

/**
 * How dark a slice goes as it approaches a face, and how bright the core gets.
 *
 * This is the OTHER axis of the edge, and the one that has now been lost twice:
 * the ramp above runs along the card's LENGTH, so without this every slice
 * paints the identical column and the thickness has no shading ACROSS itself — a
 * flat smear of brush rather than a milled edge, and the pair of face rings
 * either side of it then read as the two visible edges of two separate cards.
 * Modulating each slice by its own depth turns the stack into a specular ramp
 * across the thickness: shoulders in shadow where the material rolls away from
 * the light, a bright core where it faces it.
 */
export const EDGE_SHOULDER_SHADE = 0.34;
export const EDGE_CORE_SHEEN = 0.14;

/**
 * The iridescence a `"live"` edge carries, and why it is painted rather than
 * shaded.
 *
 * A metal-fx ring lives IN the plane it is mounted on, so a ring on a slice is
 * exactly the thing you cannot see once that slice turns edge-on: at 80° a 1px
 * band compresses to a seventh of a pixel. The mid-plane ring is still worth its
 * instance for the angles either side of that, but it can never be what makes
 * the thickness read as the same chrome as the faces. This does: the chromatic
 * preset's own hue sweep, laid over the core slices at the weight the sheen
 * uses, so the milled edge is tinted by the same colours travelling around the
 * ring instead of being a neutral grey band next to them.
 */
export const EDGE_CHROMA = 0.13;
export const EDGE_CHROMA_SWEEP = (alpha: string) =>
	`linear-gradient(180deg, rgba(255, 122, 190, ${alpha}) 0%, rgba(255, 206, 128, ${alpha}) 30%, rgba(128, 232, 255, ${alpha}) 58%, rgba(172, 148, 255, ${alpha}) 100%)`;

/**
 * The fill for one slice: the lengthwise ramp, tinted for its own depth.
 *
 * Layered as background images rather than a `filter: brightness()` because a
 * filter would give every slice its own composited layer inside a `preserve-3d`
 * context, and the first background layer is the topmost — hence shade, sheen,
 * chroma, then the metal underneath.
 *
 * `iridescent` is the EDGE FINISH (`edge === "live"` on a ringed card), not the
 * "does this plane carry the mid-plane metal-fx ring" flag that shares the word
 * in `CardExtrusion`. The chroma is meant to reach every core slice; narrowing
 * it to the single ringed plane would leave the rest of the thickness grey.
 */
export function edgeSliceFill(depth: number, iridescent: boolean): string {
	const shade = Math.min(1, Math.abs(depth) / CARD_HALF_THICKNESS_PX);
	const shadow = (EDGE_SHOULDER_SHADE * shade).toFixed(3);
	const sheen = (EDGE_CORE_SHEEN * (1 - shade)).toFixed(3);
	const chroma = (EDGE_CHROMA * (1 - shade)).toFixed(3);
	return [
		`linear-gradient(rgba(10, 10, 14, ${shadow}), rgba(10, 10, 14, ${shadow}))`,
		`linear-gradient(rgba(255, 255, 255, ${sheen}), rgba(255, 255, 255, ${sheen}))`,
		...(iridescent ? [EDGE_CHROMA_SWEEP(chroma)] : []),
		EDGE_METAL,
	].join(", ");
}

/** Relative luminance of a `#rrggbb` string, 0–1. Used by the ramp's own test. */
export function edgeStopLuminance(color: string): number {
	const hex = color.replace("#", "");
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
