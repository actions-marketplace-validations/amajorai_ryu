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
// The TILE the art is painted on is a `variant`, not a second component: `card`
// for every grid/row/sidebar square, `hero` for the large one that sits on a detail
// hero's wash. The hero used to paint its own square inline in
// `listing-detail-shell.tsx` and take the art as an opaque ReactNode, which made
// every hero call site a bypass by construction — the two that DID pass an
// `<AppIcon>` stacked both tiles, one inside the other.
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
import {
	APP_ICON_TILE_CARD,
	APP_ICON_TILE_CARD_GLYPH,
	APP_ICON_TILE_CARD_SURFACE,
	APP_ICON_TILE_HERO,
	APP_ICON_TILE_HERO_SURFACE,
} from "@ryu/ui/lib/app-icon-tile.ts";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { useCachedIconUrl } from "../icon-cache.ts";
import { resolveCardIcon } from "../icon-url.ts";
import type { CardDither, CardThemePreview } from "../types.ts";
import BrandOrCoverImage, { normalizeIconPadding } from "./brand-image.tsx";
import { ditherDissolves, normalizeDither, opaqueDither } from "./dither.ts";
import { OPPOSITE_DIRECTION } from "./dither-banner.tsx";

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
	/** The listing's declared inset for its raster mark (manifest `iconPadding`).
	 *  A raw wire string; validated here rather than by the caller, so a card and a
	 *  hero cannot disagree about what an unrecognized value means. */
	iconPadding?: string | null;
	/** Raster logo URL. */
	iconUrl?: string | null;
	/** Display name — the seed of last resort, and the img alt. */
	name?: string | null;
	/** Stable seed for the generative tile — ALWAYS the item's unique id (the
	 *  plugin id, not its label), so the same app tiles identically everywhere. */
	seedId?: string | null;
	/** Paint the seeded generative tile BEHIND the item's art when it declares no
	 *  plate of its own (no `dither`, no `iconBackground`), instead of the flat
	 *  theme surface.
	 *
	 *  For community listings. A packaged first-party manifest always declares a
	 *  wash, so first-party cards are painted squares; a GitHub-discovered repo
	 *  usually declares only an `icon`, which left its card as a bare glyph on flat
	 *  `bg-muted` sitting in a grid of painted plates — the community rows read as
	 *  a different, lesser component rather than as the same one. The seed is the
	 *  listing's own id, so the plate distinguishes listings from each other rather
	 *  than lumping one publisher's repos under a shared mark. */
	seedPlate?: boolean;
	/** Pixel size handed to the Icon primitive. Keep in step with `className`'s
	 *  box: an Icon needs an explicit box, unlike a class-sized Hugeicons element. */
	size?: number;
	/** A theme listing's own palette (manifest `contributes.themes[0].preview`).
	 *  When the item ships no art of its own, this is painted as the tile instead
	 *  of the generative avatar: for a theme the swatch IS the identity, and it is
	 *  the same icon the Appearance tab's preset picker shows. Real art (an
	 *  `iconId`/`iconUrl`/`fallback`) still wins over it — a theme that also ships
	 *  a logo shows the logo. */
	themePreview?: CardThemePreview | null;
	/** Which of the two tile treatments to paint — the small square in a grid, row,
	 *  sidebar entry or tab strip (`card`, the default), or the large square that
	 *  sits ON a detail hero's wash above its scrim (`hero`).
	 *
	 *  They are a variant rather than two components because only the TILE differs:
	 *  the resolution order, the dither validation and the caching above are the
	 *  same object painted at two sizes. And they cannot be merged, because the hero
	 *  tile's backdrop is the listing's own author-supplied wash instead of a theme
	 *  surface — so it fixes its glyph white (via {@link APP_ICON_TILE_HERO}) and
	 *  must therefore force the wash OPAQUE, where the card follows the theme and
	 *  leaves the wash exactly as declared. Painting the card treatment on a hero
	 *  loses the glyph on the light end of every standard dissolving wash. */
	variant?: "card" | "hero";
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
	iconPadding,
	iconId,
	iconUrl,
	name,
	seedId,
	seedPlate = false,
	size = 20,
	themePreview,
	variant = "card",
}: AppIconProps) {
	const isHero = variant === "hero";
	// The hero forces the spec opaque; the card paints it as declared. This is the
	// legibility branch the treatment cannot ship without: every packaged manifest
	// declares a wash that dissolves to transparent, and the hero tile's foreground
	// is a fixed white it cannot adapt away from, so the dissolved end of a 5rem
	// tile would swallow the glyph. `opaqueDither` re-ramps the listing's OWN hue,
	// so the tile still carries the app's colour — it just covers its box.
	// The hero re-ramps a wash to opaque ONLY when that wash dissolves. That is the
	// case the fixed white glyph cannot survive (the dissolved end of a 5rem tile
	// shows the banner through, and white on a light banner is invisible), and it
	// is the whole reason the re-ramp exists.
	//
	// It used to apply to EVERY hero wash, including the ones that already cover
	// their box — so an app with a two-tone plate was painted one way on its card
	// and a different, more saturated way in the preview dialog. Same app, same
	// declared plate, two colours: exactly the "why is the icon in the preview
	// different from the actual app icon" report. A wash that already covers its
	// box now paints identically in both places.
	const declaredDither = normalizeDither(dither);
	const safeDither =
		isHero && declaredDither && ditherDissolves(declaredDither)
			? opaqueDither(declaredDither)
			: declaredDither;
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
	// takes neither the dither nor the flat background beneath it). A theme listing
	// that carries a `themePreview` swaps that tile for the theme's own bar swatch
	// (bg / surface / primary), so a theme reads as its palette rather than as a
	// random-hue avatar.
	const seed = seedId || name || "";
	const isPlaceholder =
		!(resolvedIconId || resolvedIconUrl || fallback) &&
		(!!seed || !!themePreview);

	let content: ReactNode;
	if (resolvedIconId) {
		content = <Icon icon={cachedGlyph ?? resolvedIconId} size={size} />;
	} else if (resolvedIconUrl) {
		content = (
			<BrandOrCoverImage
				brand={isBrandMark === true}
				dark={cachedDark ?? resolvedIconUrlDark ?? null}
				light={cachedLight ?? resolvedIconUrl}
				padding={normalizeIconPadding(iconPadding)}
			/>
		);
	} else {
		content = fallback ?? null;
	}

	const flatBackground =
		!safeDither && iconBackground ? { background: iconBackground } : undefined;

	// The seeded plate stands in for a declared one, so it applies only when the
	// item has art to sit ON and declared no plate itself. `isPlaceholder` already
	// covers the art-less case with the same tile at full bleed.
	const usesSeedPlate =
		seedPlate && !isPlaceholder && !safeDither && !iconBackground && !!seed;

	// The glyph colour follows how far the wash actually covers the square. A
	// two-tone dither paints edge to edge, so white always reads on it. The
	// standard spec dissolves to transparent, which leaves the square's far end as
	// whatever is behind it — on a light surface that is nearly white, and a white
	// glyph on it is invisible. `text-foreground` reads at both ends in both themes.
	//
	// The hero has no such branch: its own tile constant fixes `text-white`, which
	// is safe there precisely because the wash above was forced opaque.
	let glyphColor = "";
	if (!isHero) {
		if (safeDither) {
			glyphColor = ditherDissolves(safeDither)
				? "text-foreground"
				: "text-white";
		} else if (usesSeedPlate) {
			// The seeded tile paints edge to edge in saturated colour, the same
			// condition under which a two-tone dither takes white above.
			glyphColor = "text-white";
		} else {
			glyphColor = APP_ICON_TILE_CARD_GLYPH;
		}
	}

	return (
		<span
			className={cn(
				isHero ? APP_ICON_TILE_HERO : APP_ICON_TILE_CARD,
				glyphColor,
				isPlaceholder || safeDither || iconBackground || usesSeedPlate
					? ""
					: isHero
						? APP_ICON_TILE_HERO_SURFACE
						: APP_ICON_TILE_CARD_SURFACE,
				className
			)}
			style={flatBackground}
		>
			{isPlaceholder ? (
				themePreview ? (
					// The theme's own palette as the tile: the same three stacked
					// bars (bg / surface / primary) the Appearance tab's preset
					// picker paints. Proportions match `PresetSwatch` (32×20 → the
					// surface bar is a quarter, the primary a fifth), so the card
					// and the picker agree about what a theme looks like.
					<span className="flex size-full flex-col overflow-hidden">
						<span
							className="block flex-1"
							style={{ backgroundColor: themePreview.bg }}
						/>
						<span
							className="block h-[25%]"
							style={{ backgroundColor: themePreview.surface }}
						/>
						<span
							className="block h-[20%]"
							style={{ backgroundColor: themePreview.primary }}
						/>
					</span>
				) : (
					<DitherAvatar animate={false} className="size-full" name={seed} />
				)
			) : (
				<>
					{usesSeedPlate ? (
						<DitherAvatar
							animate={false}
							className="absolute inset-0 size-full"
							name={seed}
						/>
					) : null}
					{safeDither ? (
						<DitherGradient
							// On a hero the tile washes in the OPPOSITE direction to the
							// banner behind it, so it reads as a tile sitting ON the hero
							// rather than as a hole punched through it.
							direction={
								isHero
									? OPPOSITE_DIRECTION[safeDither.direction ?? "up"]
									: safeDither.direction
							}
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
