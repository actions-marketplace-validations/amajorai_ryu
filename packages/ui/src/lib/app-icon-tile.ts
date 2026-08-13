// packages/ui/src/lib/app-icon-tile.ts
//
// The app/plugin icon TILE, as class strings — the two treatments an item's art is
// ever painted on, in one file.
//
// The component that owns them is `AppIcon`
// (`@ryu/marketplace/catalog/chrome/app-icon`), and a surface that CAN render it
// must: the component also carries the resolution order (glyph id → raster → brand
// mark → generative avatar), the dither validation, and the legibility branch that
// decides the glyph colour. None of that is expressible as a class string, so these
// constants are not an alternative to `AppIcon` — they are the fallback for the two
// places the component cannot reach:
//
//   - `@ryu/blocks`, which `@ryu/marketplace` DEPENDS ON. The arrow only points one
//     way, so a block can never import `AppIcon`.
//   - `apps/web`, whose marketplace pages are React Server Components and cannot
//     mount a component that calls `useSvglIndex`/`useCachedIconUrl`.
//
// Before this file each of those hand-wrote its own square, and the drift is
// measurable: the store card rounds `rounded-lg` with no border, the paid strip card
// rounded `rounded-lg` WITH one, and the web detail page rounded `rounded-xl` with
// one — three radii and two border rules for the same object. A shared constant
// cannot stop a fourth from being typed, but it does mean the three that exist now
// change together.
//
// SIZING IS NOT IN HERE. Every call site sizes its own box (`size-10` on a card,
// `size-16 sm:size-20` on a hero, `size-5` in the sidebar), and baking one size in
// would make the constant unusable at the next size up.
//
// THE SURFACE AND THE GLYPH COLOUR ARE SEPARATE CONSTANTS, and that is not
// over-splitting: in `AppIcon` they fire on different conditions. The plate drops
// out as soon as the item declares EITHER a dither wash or a flat `iconBackground`
// (both cover the square themselves), while the muted glyph colour survives a flat
// `iconBackground` and is replaced only by a dither's own legibility rule. Bundled
// into one string, a caller with an `iconBackground` would have to apply both or
// neither, and both are wrong.

/** The card/list tile: the small square beside a listing's name in any grid, row,
 *  sidebar entry or tab strip. Compose with a size class, plus
 *  {@link APP_ICON_TILE_CARD_SURFACE} / {@link APP_ICON_TILE_CARD_GLYPH} as the
 *  item's own presentation fields allow. */
export const APP_ICON_TILE_CARD =
	"relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg";

/** The neutral plate under a card tile. Apply ONLY when the item declares neither a
 *  dither wash nor a flat `iconBackground` — either of those paints the square
 *  itself, and stacking the muted surface behind them just hides one of the two. */
export const APP_ICON_TILE_CARD_SURFACE = "bg-muted";

/** The card tile's foreground: the glyph colour that reads on the muted surface (and
 *  on an ordinary flat `iconBackground`) in both themes. Drop it only when a dither
 *  wash is painted — a wash brings its own foreground rule, because whether it
 *  covers the square edge to edge or dissolves decides whether white is legible. */
export const APP_ICON_TILE_CARD_GLYPH = "text-muted-foreground";

/** The detail-hero tile: the large square that sits ON the hero wash, above the
 *  scrim. Deliberately NOT the card treatment — a bigger radius, a ring and a shadow
 *  to lift it off the band it overlaps, and a FIXED white foreground.
 *
 *  The fixed foreground is the load-bearing part and the reason the two treatments
 *  cannot be merged. The tile's backdrop is the hero's own author-supplied wash, not
 *  a theme surface, so a theme-aware glyph colour is unreadable on half the hues
 *  that ship. A surface using this constant must therefore also force its wash
 *  OPAQUE (`opaqueDither`): the standard spec every packaged manifest declares
 *  dissolves to transparent, and a white glyph on the dissolved end of a light
 *  banner disappears entirely. */
export const APP_ICON_TILE_HERO =
	"relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white shadow-lg ring-1 ring-white/25";

/** The translucent plate under a hero tile, on the same "no wash, no
 *  `iconBackground`" condition as {@link APP_ICON_TILE_CARD_SURFACE}. Translucent
 *  rather than opaque so the hero's own band still reads through the square instead
 *  of a grey hole appearing in it. */
export const APP_ICON_TILE_HERO_SURFACE = "bg-background/20";
