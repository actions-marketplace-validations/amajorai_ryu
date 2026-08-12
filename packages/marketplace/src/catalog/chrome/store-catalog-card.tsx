// packages/marketplace/src/catalog/chrome/store-catalog-card.tsx
//
// The one card every Store catalog list renders: borderless, no background at
// rest (just a hover/selected wash), a muted-background icon on the left, the
// name + a one-line description beside it, and the lifecycle action on the right.
// Shared so Apps, Plugins, Models, Skills, MCP, and Agents look identical.
//
// The row is NOT a single <button> (that would nest the action button inside it):
// the icon+text is one button that opens the preview, the action sits beside it.
//
// The card carries the MINIMUM that distinguishes one listing from another: icon,
// name, one-line description, and a stability badge when the listing is unfinished.
// The platform-surface badges used to sit here too and were the one thing that made
// a two-column grid of rows look busy — six chips under every app, mostly identical.
// They now live in the preview's stat strip (`ListingStatStrip`), which is where the
// rest of the "will this work for me?" metadata already is.
//
// The icon square is NOT rendered here: it is `AppIcon`, the one component every
// surface that shows an app uses. This file used to carry its own copy of that
// square AND its own copy of the untrusted-dither validator, which is how it drifted
// out from under the legibility rule the shared code already enforced — the copy
// here painted a hardcoded white glyph on any valid dither, and every packaged
// manifest now declares a wash that DISSOLVES to transparent, so on a light theme
// the far end of the square is nearly white and the glyph vanished on it. One
// component means a surface cannot ship without that branch again.

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { stabilityLabel } from "../stability.ts";
import type { CardDither } from "../types.ts";
import AppIcon from "./app-icon.tsx";
import VerifiedBadge from "./verified-badge.tsx";

export default function StoreCatalogCard({
	cacheKey,
	brandIcon,
	iconId,
	iconUrl,
	iconBackground,
	dither,
	name,
	seedId,
	description,
	stability,
	orgVerified,
	orgVerifiedTier,
	selected = false,
	onClick,
	action,
	contextMenu,
}: {
	/** Persist this card's icon bytes under `<id>@<version>` (see `iconCacheKey`),
	 *  so it paints offline and re-fetches only when the app updates. Set it for
	 *  INSTALLED items; leave it unset when browsing a catalog, where a listing has
	 *  no installed version to key on and the cache would fill with art for items
	 *  the user only scrolled past. */
	cacheKey?: string | null;
	/** Legacy fallback glyph. Accepted so the ~15 call sites that pass one keep
	 *  compiling, but NOT rendered: an item with no `iconId`/`iconUrl`/`brandIcon`
	 *  gets the generative tile seeded from its id, which is specific to the item
	 *  where a generic glyph is not. It has never rendered — the old inline square
	 *  reached for it only in the branch where the avatar already won. Optional now
	 *  rather than required, so a new call site is not made to hand over a node that
	 *  goes nowhere; the existing callers that pass one still compile. */
	icon?: ReactNode;
	/** A ready-made brand-mark node (e.g. `AgentCatalogLogo`, themed + its own
	 *  fallback). Wins over the generative dither avatar the way `iconId`/`iconUrl`
	 *  do, so a card with a real logo shows it instead of a placeholder tile. */
	brandIcon?: ReactNode;
	/** An Icon-primitive id (Iconify `prefix:name`, bare Hugeicons name). Wins over
	 *  `iconUrl` and `icon`; painted with the current text colour. */
	iconId?: string | null;
	/** A resolvable icon image (Iconify/icons0.dev/remote logo). Wins over `icon`. */
	iconUrl?: string | null;
	/** Optional CSS background for the icon square (e.g. a solid/gradient colour). */
	iconBackground?: string;
	/** Optional dithered-gradient background for the icon square. Validated before
	 *  paint; a malformed spec is ignored and the flat/`img` path is used. Wins over
	 *  `iconBackground` when valid. */
	dither?: CardDither | null;
	name: string;
	/** Stable seed for the placeholder dither avatar — the item's unique id
	 *  (`namespace/name`, a model/skill id, …) when available, else the name. */
	seedId?: string | null;
	description?: string | null;
	/** How finished this listing is ("alpha", "beta", …). Absent/stable renders
	 *  nothing — a finished listing must not sprout a badge. */
	stability?: string | null;
	/** The PUBLISHING ORGANIZATION is identity-verified — the blue check beside the
	 *  name. One of THREE separate axes, never to be merged: `reviewed` is "did Ryu
	 *  vet this listing's CODE" (the amber "Not reviewed by Ryu" notice),
	 *  `verification` is "did the manifest SIGNATURE verify" (install trust, and
	 *  the field that owns the bare word `verified` on the web marketplace's wire),
	 *  and this is "do we know who published it". A verified org can publish an
	 *  unreviewed listing and both signals then render together. Optional and
	 *  absent-renders-nothing, because ~15 out-of-package call sites build this
	 *  card and only the ones whose feed carries the flag pass it. */
	orgVerified?: boolean;
	/** The org's verification tier, used only as a qualifier in the badge's label.
	 *  Camel-cased like every other prop even though the card payload spells it
	 *  `org_verified_tier` — props are camelCase regardless of the wire's casing. */
	orgVerifiedTier?: string | null;
	selected?: boolean;
	onClick: () => void;
	/** The right-hand lifecycle control (see {@link StoreItemAction}). */
	action?: ReactNode;
	/** Optional right-click context menu content for the card. */
	contextMenu?: ReactNode;
}) {
	const card = (
		<div
			className={cn(
				"group flex items-center gap-3 rounded-xl pr-2 transition-colors",
				selected ? "bg-accent" : "hover:bg-accent/50"
			)}
		>
			<button
				className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-2.5 text-left"
				onClick={onClick}
				type="button"
			>
				{/* `brandIcon` is the ONLY node forwarded as AppIcon's `fallback`: it is a
				    real logo, so it must suppress the generative tile the way an
				    `iconId`/`iconUrl` does. The legacy `icon` prop is deliberately not
				    forwarded — it never rendered here either (the generative avatar
				    always won that branch), and honouring it now would swap a tile
				    specific to the app for a generic glyph on every art-less listing. */}
				<AppIcon
					cacheKey={cacheKey}
					className="size-10"
					dither={dither}
					fallback={brandIcon}
					iconBackground={iconBackground}
					iconId={iconId}
					iconUrl={iconUrl}
					name={name}
					seedId={seedId}
				/>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5">
						<span className="truncate font-medium text-sm">{name}</span>
						{/* Beside the NAME, not on the icon: the icon is the app's own
						    identity, the check is a claim about who published it. `shrink-0`
						    so a long name truncates and the badge survives. */}
						<VerifiedBadge orgVerified={orgVerified} tier={orgVerifiedTier} />
						{stabilityLabel(stability) ? (
							<span className="shrink-0 rounded-sm border border-amber-500/40 px-1 py-px text-[10px] text-amber-600 leading-tight">
								{stabilityLabel(stability)}
							</span>
						) : null}
					</span>
					<span className="block truncate text-muted-foreground text-xs">
						{description || "No description provided."}
					</span>
				</span>
			</button>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);

	if (!contextMenu) {
		return card;
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger render={card} />
			<ContextMenuContent align="end">{contextMenu}</ContextMenuContent>
		</ContextMenu>
	);
}
