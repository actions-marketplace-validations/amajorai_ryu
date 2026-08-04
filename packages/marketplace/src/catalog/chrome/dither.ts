// packages/marketplace/src/catalog/chrome/dither.ts
//
// Validation for the untrusted `icon_dither` spec a catalog entry carries, shared
// by every surface that paints one (the list card's icon square, the detail hero,
// the hero's own icon tile).
//
// It lives in its own module rather than on the card because the validator is the
// safety boundary, not a rendering detail: `fillOf` THROWS on an unknown palette
// name, so a typo'd colour in one manifest would take down the whole catalog list
// with a render error. Exactly one implementation means a new painting surface
// cannot accidentally ship without the guard.

import type { GradientDirection } from "@ryu/ui/components/dither-kit/gradient.tsx";
import {
	type DitherColor,
	isDitherColor,
} from "@ryu/ui/components/dither-kit/palette.ts";
import type { CardDither } from "../types.ts";

/** The four gradient directions dither-kit accepts. */
const DIRECTIONS: GradientDirection[] = ["up", "down", "left", "right"];

/** Normalize ONE untrusted colour token to a dither-kit `PixelColor`: a finite hue
 *  number, or a known palette-colour name. Anything else (typo'd name, NaN, object)
 *  → null, so a malformed remote card never reaches `fillOf`, which throws on an
 *  unknown name. */
function normalizeColor(value: unknown): DitherColor | number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (isDitherColor(value)) {
		return value;
	}
	return null;
}

/** A dither spec that is safe to hand to `DitherGradient`. `from` is guaranteed
 *  valid; `to`/`direction` are already validated (or omitted so the component's own
 *  defaults apply). */
export interface SafeDither {
	direction?: GradientDirection;
	from: DitherColor | number;
	to?: DitherColor | number | "transparent";
}

/** Validate an untrusted {@link CardDither} into a {@link SafeDither}, or null when
 *  it can't paint. `from` MUST resolve (else the whole spec is dropped and the
 *  caller falls back to its flat/`img` path); `to` accepts "transparent" or a valid
 *  colour (else omitted → transparent); an unknown `direction` is dropped (→ "up"). */
export function normalizeDither(dither?: CardDither | null): SafeDither | null {
	if (!dither) {
		return null;
	}
	const from = normalizeColor(dither.from);
	if (from === null) {
		return null;
	}
	const safe: SafeDither = { from };
	if (dither.to === "transparent") {
		safe.to = "transparent";
	} else {
		const to = normalizeColor(dither.to);
		if (to !== null) {
			safe.to = to;
		}
	}
	if (
		typeof dither.direction === "string" &&
		DIRECTIONS.includes(dither.direction as GradientDirection)
	) {
		safe.direction = dither.direction as GradientDirection;
	}
	return safe;
}
