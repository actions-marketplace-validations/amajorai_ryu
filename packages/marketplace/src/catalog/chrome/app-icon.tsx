// packages/marketplace/src/catalog/chrome/app-icon.tsx
//
// THE app/plugin icon. One component, every surface.
//
// The rounded icon square used to live inline inside `store-catalog-card.tsx`, so
// only the Store's Apps and Plugins lists ever rendered a listing's real art. Every
// other surface that shows the same app — the Installed tab, the sidebar, the
// workspace tab strips, the composer's "+" menu — re-implemented its own version,
// and each one stopped at whatever it happened to have on hand: a hardcoded glyph,
// or a bare `<Icon>` with no background. The same app therefore looked like four
// different things depending on where you saw it.
//
// The resolution order is the load-bearing part, and it is why this cannot be a
// bare `<Icon>` call at each site:
//
//   1. `iconId`   — an Icon-primitive id, painted in the current text colour.
//   2. `iconUrl`  — a raster logo or an `svgl:` brand mark.
//   3. `brandIcon`/`fallback` — a caller-supplied node.
//   4. a generative `DitherAvatar` seeded from the item's id.
//
// and, independently, the BACKGROUND: a validated dither gradient wins, else a flat
// `iconBackground`, else the muted default — except under the generative avatar,
// which paints its own tile edge to edge.
//
// Step 4 is the reason a shared component matters more than it looks. An app with
// no art of its own gets a deterministic tile derived from its id, so it still
// reads as *that app* rather than as one repeated grey glyph — but only if every
// surface seeds it identically. Two surfaces passing different seeds for the same
// app produce two different tiles, which is worse than no tile at all.

import { DitherAvatar } from "@ryu/ui/components/dither-kit/avatar.tsx";
import { DitherGradient } from "@ryu/ui/components/dither-kit/gradient.tsx";
import { Icon, iconToUrl } from "@ryu/ui/components/icon.tsx";
import { useSvglIndex } from "@ryu/ui/components/svgl.ts";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { useCachedIconUrl } from "../icon-cache.ts";
import { resolveCardIcon } from "../icon-url.ts";
import type { CardDither } from "../types.ts";
import BrandOrCoverImage from "./brand-image.tsx";
import { ditherDissolves, normalizeDither } from "./dither.ts";

export interface AppIconProps {
	/** Persist this icon's bytes under `<id>@<version>` (see
	 *  {@link iconCacheKey}), so it paints offline and is re-fetched only when the
	 *  app updates. Set it for anything INSTALLED; leave it unset while browsing a
	 *  catalog, where there is no installed version to key on. */
	cacheKey?: string | null;
	/** Extra classes for the square (sizing lives here: `size-10`, `size-5`, …). */
	className?: string;
	/** Validated before use; an unpaintable spec falls through to `iconBackground`. */
	dither?: CardDither | null;
	/** Last-resort node when the item ships no art AND `seedId`/`name` is empty.
	 *  Prefer leaving this unset: the generative avatar is a better fallback than a
	 *  generic glyph, because it is at least specific to the item. */
	fallback?: ReactNode;
	/** Flat CSS background, used only when `dither` is absent or invalid. */
	iconBackground?: string | null;
	/** Icon-primitive id (Iconify `prefix:name`, bare Hugeicons name, `svgl:<slug>`). */
	iconId?: string | null;
	/** Raster logo URL. */
	iconUrl?: string | null;
	/** Display name — the seed of last resort, and the img alt. */
	name?: string | null;
	/** Stable seed for the generative tile — ALWAYS the item's unique id (the
	 *  plugin id, not its label), so the same app tiles identically everywhere. */
	seedId?: string | null;
	/** Pixel size handed to the Icon primitive. Keep in step with `className`'s
	 *  box: an Icon needs an explicit box, unlike a class-sized Hugeicons element. */
	size?: number;
}

/**
 * The canonical app/plugin icon square.
 *
 * Renders the item's real art when it has any, and a deterministic generative tile
 * when it does not. Pass the manifest's presentational fields straight through —
 * `icon`, `iconUrl`, `iconDither`, `iconBackground` — plus the item's id as
 * `seedId`.
 */
export default function AppIcon({
	cacheKey,
	className,
	dither,
	fallback,
	iconBackground,
	iconId,
	iconUrl,
	name,
	seedId,
	size = 20,
}: AppIconProps) {
	const safeDither = normalizeDither(dither);
	const svglIndex = useSvglIndex();
	const {
		iconId: resolvedIconId,
		iconUrl: resolvedIconUrl,
		iconUrlDark: resolvedIconUrlDark,
		brand: isBrandMark,
	} = resolveCardIcon({ icon: iconId, iconUrl, svglIndex });

	// Both icon lanes are cached: an Icon-primitive id resolves to a hosted SVG on
	// api.iconify.design just as surely as a raster logo resolves to a CDN URL, so
	// caching only the raster half would still leave most installed apps painting
	// blank while offline. The glyph is re-rendered through the SAME `Icon`
	// primitive either way (`iconToUrl` passes a `data:` URI through unchanged), so
	// the CSS-mask treatment — and with it `currentColor` — is preserved.
	//
	// Each lane gets its OWN key suffix. One app can carry a glyph and a light and a
	// dark mark at once, and a single shared key would have the three lanes
	// overwrite each other's bytes on every render — a cache that thrashes forever
	// instead of one that hits.
	const glyphSource = resolvedIconId
		? iconToUrl(resolvedIconId, { size })
		: null;
	const cachedGlyph = useCachedIconUrl(
		glyphSource,
		// The size is part of the key because it is part of the URL: `iconToUrl`
		// asks Iconify for a glyph at an explicit width/height, so the 12px sidebar
		// row, the 20px card and the 28px hero request three different assets for
		// one app. Keyed without it they would each overwrite the other two on every
		// render and no surface would ever get a hit.
		cacheKey ? `${cacheKey}|glyph@${size}` : null
	);
	const cachedLight = useCachedIconUrl(
		resolvedIconUrl ?? null,
		cacheKey ? `${cacheKey}|light` : null
	);
	const cachedDark = useCachedIconUrl(
		resolvedIconUrlDark ?? null,
		cacheKey ? `${cacheKey}|dark` : null
	);

	// No art of its own → the generative tile, which paints the whole square (so it
	// takes neither the dither nor the flat background beneath it).
	const seed = seedId || name || "";
	const isPlaceholder =
		!(resolvedIconId || resolvedIconUrl || fallback) && !!seed;

	let content: ReactNode;
	if (resolvedIconId) {
		content = <Icon icon={cachedGlyph ?? resolvedIconId} size={size} />;
	} else if (resolvedIconUrl) {
		content = (
			<BrandOrCoverImage
				brand={isBrandMark === true}
				dark={cachedDark ?? resolvedIconUrlDark ?? null}
				light={cachedLight ?? resolvedIconUrl}
			/>
		);
	} else {
		content = fallback ?? null;
	}

	const flatBackground =
		!safeDither && iconBackground ? { background: iconBackground } : undefined;

	// The glyph colour follows how far the wash actually covers the square. A
	// two-tone dither paints edge to edge, so white always reads on it. The
	// standard spec dissolves to transparent, which leaves the square's far end as
	// whatever is behind it — on a light surface that is nearly white, and a white
	// glyph on it is invisible. `text-foreground` reads at both ends in both themes.
	const glyphColor = safeDither
		? ditherDissolves(safeDither)
			? "text-foreground"
			: "text-white"
		: "text-muted-foreground";

	return (
		<span
			className={cn(
				"relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg",
				glyphColor,
				isPlaceholder || safeDither || iconBackground ? "" : "bg-muted",
				className
			)}
			style={flatBackground}
		>
			{isPlaceholder ? (
				<DitherAvatar animate={false} className="size-full" name={seed} />
			) : (
				<>
					{safeDither ? (
						<DitherGradient
							direction={safeDither.direction}
							from={safeDither.from}
							to={safeDither.to}
						/>
					) : null}
					<span className="relative flex items-center justify-center">
						{content}
					</span>
				</>
			)}
		</span>
	);
}
