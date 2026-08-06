// packages/marketplace/src/catalog/chrome/dither-banner.tsx
//
// The listing hero's background wash. Extracted out of `apps-catalog-section.tsx`
// so every realm's detail hero paints the same thing — the Apps/Plugins hero was
// the only one that had it, which is why an app opened with real art and an MCP
// server or an engine opened with a flat grey slab.
//
// Three tiers, in order:
//
//  1. **The listing's own `icon_dither`** — the generative wash its CARD already
//     shows. Using it here is why hero and card never disagree.
//  2. **An explicit `banner`** (author-declared colours, or `style: "dither"` with
//     a noise overlay). Outranks tier 1: it is the author saying "the hero is not
//     just my icon, bigger".
//  3. **A flat fallback** — `icon_background`/`accent_color`, else the muted
//     surface.
//
// Tier 1 is the reason the store stopped looking generic: with no `banner` (which
// no first-party manifest has ever declared) every hero painted the SAME hardcoded
// indigo `linear-gradient`, so all 62 detail pages opened with an identical purple
// slab that had nothing to do with the app.

import {
	DitherGradient,
	type GradientDirection,
} from "@ryu/ui/components/dither-kit/gradient.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useId } from "react";
import type { CardDither, CatalogBanner } from "../types.ts";
import { normalizeDither } from "./dither.ts";

/** The icon tile inside the hero washes in the OPPOSITE direction to the banner
 *  behind it, so the two do not blend into one flat field — the tile has to read
 *  as a tile sitting on the hero, not as a hole in it. */
export const OPPOSITE_DIRECTION: Record<GradientDirection, GradientDirection> =
	{
		up: "down",
		down: "up",
		left: "right",
		right: "left",
	};

export default function DitherBanner({
	banner,
	dither,
	fallback,
}: {
	banner?: CatalogBanner | null;
	/** The listing's `icon_dither`, untrusted; validated before paint. */
	dither?: CardDither | null;
	fallback?: string | null;
}) {
	const filterId = useId();
	const safeDither = normalizeDither(dither);
	const colors = banner?.colors?.length ? banner.colors : null;
	const explicitBanner = colors || banner?.style === "dither";

	if (safeDither && !explicitBanner) {
		return (
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-muted"
				// `relative`-free: DitherGradient absolutely fills its nearest
				// positioned ancestor, which is the hero's own `relative` wrapper.
			>
				<DitherGradient
					cell={4}
					direction={safeDither.direction}
					from={safeDither.from}
					to={safeDither.to}
				/>
			</div>
		);
	}

	const gradient = colors
		? `linear-gradient(135deg, ${colors.join(", ")})`
		: (fallback ?? undefined);
	const isDither = banner?.style === "dither";

	return (
		<div
			aria-hidden="true"
			className={cn("absolute inset-0", gradient ? undefined : "bg-muted")}
			style={gradient ? { background: gradient } : undefined}
		>
			{isDither ? (
				<svg
					className="absolute inset-0 size-full opacity-30 mix-blend-overlay"
					preserveAspectRatio="none"
				>
					<title>Dither texture</title>
					<filter id={filterId}>
						<feTurbulence
							baseFrequency="0.9"
							numOctaves={2}
							seed={banner?.seed ?? 0}
							type="fractalNoise"
						/>
						<feColorMatrix type="saturate" values="0" />
					</filter>
					<rect filter={`url(#${filterId})`} height="100%" width="100%" />
				</svg>
			) : null}
		</div>
	);
}
