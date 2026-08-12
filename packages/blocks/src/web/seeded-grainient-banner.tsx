"use client";

// packages/blocks/src/web/seeded-grainient-banner.tsx
//
// The cover art a blog post or changelog entry gets when Notion has no banner
// image on it. The seed is the Notion page id, so the same post keeps the same
// art forever — a placeholder that reshuffled on every deploy would read as a
// broken image rather than as the post's own tile.
//
// Only the COLOUR is seeded. The wash's shape — dissolve to transparent, one
// direction — is fixed, and is the same shape every catalog listing's
// `iconDither` declares:
//
//   * Dissolving to transparent rather than ramping between two hues. A two-tone
//     ramp paints the box edge to edge and reads as a coloured slab with a
//     gradient on it; dissolving lets the page behind show through, so the art
//     sits ON the card instead of carrying its own background with it. That also
//     means it needs no theme handling — there is no second colour to keep
//     legible against a light or dark surface.
//   * One direction, always "down". A grid of blog cards each fading a different
//     way reads as a scatter of unrelated tiles; one direction makes the column
//     read as one system. "down" puts the solid end at the TOP of the box, so the
//     art melts into the card body beneath it rather than stopping at a hard edge
//     above the title.
//
// Nothing is painted over these banners (the title and byline sit below the box),
// so unlike the catalog surfaces there is no foreground legibility question here.

import { DitherGradient } from "@ryu/ui/components/dither-kit/gradient";
import type { DitherColor } from "@ryu/ui/components/dither-kit/palette";
import { fnv1a, xorshift32 } from "@ryu/ui/components/dither-kit/pixel";
import { cn } from "@ryu/ui/lib/utils";
import { useMemo } from "react";

const BANNER_COLORS: DitherColor[] = [
	"purple",
	"blue",
	"green",
	"pink",
	"orange",
	"red",
];

export function SeededGrainientBanner({
	seed,
	className,
}: {
	seed: string;
	className?: string;
}) {
	const color = useMemo(() => {
		const rand = xorshift32(fnv1a(seed));
		return BANNER_COLORS[Math.floor(rand() * BANNER_COLORS.length)];
	}, [seed]);

	return (
		<div className={cn("relative overflow-hidden", className)}>
			<DitherGradient
				bloom="low"
				direction="down"
				from={color}
				opacity={0.85}
				// Explicit, even though it is the component default: this is the one
				// property the whole system standardizes on, and an omitted prop reads
				// as "nobody decided" rather than as the decision it is.
				to="transparent"
			/>
		</div>
	);
}
