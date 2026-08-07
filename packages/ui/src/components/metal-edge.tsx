"use client";

import { MetalFx } from "metal-fx";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

/**
 * The metal edge — one tuning of `metal-fx` (metal.jakubantalik.com), shared by
 * every card-shaped surface that wears it.
 *
 * It exists so the ring is one decision rather than five: the waitlist pass, the
 * agent employee badge and the queue screen's own tiles all carry the same
 * chrome, and a per-call-site copy of `preset` / `ringCssPx` / `shaderScale`
 * would drift the moment one of them was retuned. The library ships only
 * `button` (134×40 baseline, 1px ring, shaderScale 1.6) and `circle` variants —
 * neither reads correctly stretched over a card, so the ring is widened and the
 * shader zoomed out here, once.
 *
 * All instances on a page share ONE offscreen WebGL canvas inside `metal-fx`, so
 * ringing several surfaces costs one context, not one per card.
 */

/**
 * Ring thickness for a full-size card (the pass, the badge). Deliberately heavy:
 * at the library's button baseline the edge reads as a hairline on a surface this
 * big, and in light mode it disappeared into the page altogether.
 */
export const METAL_EDGE_RING_PX = 5;
/** Ring thickness for the smaller tiles beside a card, where 10px would eat the tile. */
export const METAL_EDGE_TILE_RING_PX = 3;
/** Zoomed out from the button baseline of 1.6 — pill-sized features look like noise on a card. */
const METAL_SHADER_SCALE = 0.9;
const METAL_STRENGTH = 1;

export interface MetalEdgeProps {
	/**
	 * Corner radius in CSS px. Passed explicitly rather than left to `metal-fx`
	 * to read back off the computed style, which it only re-reads on resize.
	 */
	borderRadius: number;
	children: ReactNode;
	className?: string;
	/**
	 * Let the host keep its own background and border. `metal-fx` otherwise
	 * flattens its direct child's outer chrome so consumer button styles cannot
	 * fight the ring — right for a card that paints its own face underneath,
	 * wrong for a `bg-muted` tile whose fill IS its style.
	 */
	keepHostStyles?: boolean;
	/**
	 * Freeze the animation. A paused instance still gets one frame painted, so
	 * reduced motion gets a static metallic ring rather than a blank canvas.
	 */
	paused?: boolean;
	ringPx?: number;
	/**
	 * `"auto"` follows `prefers-color-scheme`, which is wrong wherever the app
	 * has a manual theme toggle that can disagree with the OS — callers that have
	 * a resolved theme pass it.
	 */
	theme?: "auto" | "dark" | "light";
}

export function MetalEdge({
	borderRadius,
	children,
	className,
	keepHostStyles = false,
	paused = false,
	ringPx = METAL_EDGE_RING_PX,
	theme = "auto",
}: MetalEdgeProps) {
	return (
		<MetalFx
			borderRadius={borderRadius}
			// The ring wrapper is `display: inline-flex` and does NOT stretch its
			// child, so without these the surface renders at its intrinsic content
			// width inside a full-width column and the ring tracks the content while
			// the layout does not. `.metal-fx-content` is `width: 100%` but not
			// `height: 100%`, hence the second selector.
			// The wandering halo is tuned for a pill-sized button; over a card it
			// stops reading as a glow around an edge and becomes a wash across the
			// whole face. The shader ring — the part that IS the border — still
			// renders.
			disableGlow
			normalizeHostStyles={!keepHostStyles}
			paused={paused}
			preset="chromatic"
			ringCssPx={ringPx}
			shaderScale={METAL_SHADER_SCALE}
			strength={METAL_STRENGTH}
			theme={theme}
			variant="button"
		>
			{children}
		</MetalFx>
	);
}
