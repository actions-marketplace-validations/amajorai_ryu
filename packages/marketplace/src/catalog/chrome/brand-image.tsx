// packages/marketplace/src/catalog/chrome/brand-image.tsx
//
// The one <img> every catalog surface uses for a listing's raster art, so the
// card and the detail hero can never disagree about how a logo is framed.
//
// Two things vary and both come from {@link resolveCardIcon}:
//
//   • `brand` — a BRAND mark (an `svgl:` id, a vendor's own logo) is letterboxed
//     inside the tile. Publisher cover art still fills it, which is what makes a
//     designed app tile read as a tile rather than a stamp on a coloured square.
//   • `dark` — svgl declares a per-theme pair for marks that need one. Both are
//     rendered and CSS picks, so switching theme never refetches or flashes.

import { cn } from "@ryu/ui/lib/utils.ts";

export default function BrandOrCoverImage({
	light,
	dark = null,
	brand = false,
	className,
}: {
	/** True when this is a brand mark (contain + inset) rather than cover art. */
	brand?: boolean;
	className?: string;
	/** Dark-theme variant, when the brand ships one. */
	dark?: string | null;
	/** Default (light-theme) image. */
	light: string;
}) {
	const fit = brand ? "object-contain p-0.5" : "object-cover";
	if (!dark) {
		return (
			<img
				alt=""
				className={cn("size-full", fit, className)}
				loading="lazy"
				src={light}
			/>
		);
	}
	return (
		<>
			<img
				alt=""
				className={cn("size-full dark:hidden", fit, className)}
				loading="lazy"
				src={light}
			/>
			<img
				alt=""
				className={cn("hidden size-full dark:block", fit, className)}
				loading="lazy"
				src={dark}
			/>
		</>
	);
}
