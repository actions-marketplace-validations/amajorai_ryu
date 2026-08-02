// packages/marketplace/src/catalog/surface-labels.ts
//
// Human labels for the host surfaces a listing declares support for.
//
// Shared because BOTH the card (chrome/store-catalog-card.tsx) and the detail
// meta strip (detail/detail-panels.tsx) render them, and a listing that says
// "Desktop" in one place and "desktop" in the other reads as a bug. It lives
// beside grant-labels.ts / plugin-id.ts / safe-url.ts, the other small shared
// presentation helpers.

import type { Surface } from "./types.ts";

/** Display name per surface.
 *
 *  Pinned to {@link Surface} with `satisfies`, which is the whole point: this map
 *  had silently drifted from the contract, defining `browser` and `tui` — neither
 *  of which is a real surface, so neither could ever be rendered — while omitting
 *  `gateway`, `core`, and the actual `extension`. A manifest targeting the browser
 *  extension therefore displayed the raw token. The satisfies clause turns that
 *  class of drift into a build error. */
export const SURFACE_LABELS = {
	gateway: "Gateway",
	core: "Headless node",
	desktop: "Desktop",
	island: "Island",
	mobile: "Mobile",
	extension: "Browser extension",
	web: "Web",
	cli: "Terminal",
	// Core deserializes a surface it does not recognise onto this rather than
	// failing the manifest, so a listing built against a newer Ryu still loads.
	// Saying so plainly beats rendering a token nobody can act on.
	unknown: "Not supported on this version",
} satisfies Record<Surface, string>;

/** Label for a surface token, falling back to the raw token.
 *
 *  The fallback is deliberate: a listing written against a newer Ryu should show
 *  its new surface the day it declares it, not the day this map is updated. Core
 *  mirrors that tolerance — an unrecognised surface deserializes rather than
 *  failing the whole manifest. */
export function surfaceLabel(surface: string): string {
	return SURFACE_LABELS[surface as Surface] ?? surface;
}
