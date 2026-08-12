// packages/marketplace/src/catalog/detail/listing-detail-shell.tsx
//
// THE store listing preview. One layout, every realm, both hosts.
//
// The shape is the one every app store converged on, top to bottom:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ HERO — full-bleed wash, icon tile, name, tagline, badges     │
//   ├──────────────────────────────────────────────────────────────┤
//   │ ACTION BAR — primary CTA + secondary controls, solid surface │
//   ├──────────────────────────────────────────────────────────────┤
//   │ STAT STRIP — divided cells: rating · version · category · …  │
//   ├──────────────────────────────────────────────────────────────┤
//   │ GALLERY — screenshot rail (only when the listing ships one)  │
//   ├───────────────────────────────┬──────────────────────────────┤
//   │ MAIN — description, tabs      │ ASIDE — Information, links   │
//   └───────────────────────────────┴──────────────────────────────┘
//
// WHY A SHELL AND NOT TEN PANELS. Every realm grew its own detail body, and each
// one was authored for the 26rem side pane that `StoreCatalogLayout` used to open
// (`previewMode: "auto"`). That pane is unreachable — no caller passes the prop —
// so all ten now render as a centred modal, and a single 416px-wide column of
// stacked sections in a 1200px dialog is what "it feels so narrow" describes: the
// dialog was wide, the content never widened with it. Ten panels each inventing a
// wide layout would diverge again within a release, so the layout lives here once
// and each realm supplies only its own content.
//
// TWO COLUMNS, VIEWPORT-KEYED. `lg:` is a viewport breakpoint, not a container
// one, which is correct here rather than approximate: the dialog is
// `min(80rem,94vw)`, so it is only ever wide enough for two columns when the
// viewport itself is, and the two thresholds move together.
//
// NO HORIZONTAL SCROLL. A wide dialog must never scroll the page sideways — the
// gallery rail and the stat strip carry their own `overflow-x-auto` so a long
// screenshot set or a nine-cell strip scrolls INSIDE its band.

import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { DitherGradient } from "@ryu/ui/components/dither-kit/gradient.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { normalizeDither, opaqueDither } from "../chrome/dither.ts";
import DitherBanner, { OPPOSITE_DIRECTION } from "../chrome/dither-banner.tsx";
import { safeHttpUrl } from "../safe-url.ts";
import type { CardDither, CatalogBanner } from "../types.ts";

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function ListingDetailShell({
	hero,
	actions,
	stats,
	gallery,
	notice,
	aside,
	children,
}: {
	/** {@link ListingHero}. Omitted only by a listing with no presentation at all. */
	hero?: ReactNode;
	/** The install/enable/open controls. Rendered on a SOLID band below the hero,
	 *  not inside it: the hero wash is a saturated dither and a button sitting on
	 *  it either loses its own surface colour or has to fake one. */
	actions?: ReactNode;
	/** {@link ListingStatStrip}. */
	stats?: ReactNode;
	/** {@link ListingGalleryRail}. */
	gallery?: ReactNode;
	/** Full-width callout ahead of the fold — the community-trust notice. Placed
	 *  above the action bar so it is unavoidable BEFORE any install control. */
	notice?: ReactNode;
	/** The right rail: Information, external links, anything reference-shaped. */
	aside?: ReactNode;
	/** The main column: description, permissions, the tab set. */
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col">
			{hero}
			{notice ? <div className="px-5 pt-4 lg:px-7">{notice}</div> : null}
			{actions ? (
				<div className="flex flex-wrap items-center gap-2 border-border/60 border-b px-5 py-3 lg:px-7">
					{actions}
				</div>
			) : null}
			{stats}
			<div className="flex flex-col gap-6 px-5 py-6 lg:px-7">
				{gallery}
				<div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
					<div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
					{aside ? (
						<aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72 xl:w-80">
							{aside}
						</aside>
					) : null}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function ListingHero({
	name,
	nameBadge,
	tagline,
	badges,
	icon,
	banner,
	dither,
	iconBackground,
	fallback,
}: {
	name: ReactNode;
	/** A small marker rendered immediately after the title — today the publisher
	 *  verification check.
	 *
	 *  It is a SEPARATE slot rather than something a caller composes into `name`
	 *  (which is a `ReactNode`, so composing type-checks) because the title span
	 *  truncates: a badge appended inside it is clipped off the end for exactly the
	 *  long names nobody tests with, and reads fine for every short one.
	 *
	 *  It is also NOT a `badges` entry: those are `string[]` chips describing the
	 *  LISTING ("Built-in", "Community", "BETA"), and a claim about the publisher
	 *  rendered among them would be read as a claim about the listing. */
	nameBadge?: ReactNode;
	tagline?: ReactNode;
	/** Status/kind/tag pills. Rendered on the wash, so they get a translucent
	 *  chip treatment rather than the page's Badge variants, which assume a
	 *  neutral surface. */
	badges?: string[];
	/** The listing's art, already resolved by the caller (an `AppIcon`, a brand
	 *  mark, a glyph). Painted on a tile with its own counter-direction wash. */
	icon?: ReactNode;
	banner?: CatalogBanner | null;
	dither?: CardDither | null;
	iconBackground?: string | null;
	/** Flat CSS background when there is neither a banner nor a dither. */
	fallback?: string | null;
}) {
	// The tile is the one surface here whose foreground CANNOT adapt: it is
	// `text-white` because it sits on the hero's own wash, above the scrim, and a
	// theme-aware glyph colour would be unreadable on a dark banner. So the tile
	// forces its spec opaque instead of branching on it. Every packaged manifest now
	// declares a wash that dissolves to transparent; painted as-is, the far end of
	// this 5rem tile would be whatever the banner behind it happens to be, and a
	// white glyph on the light end of that disappears. `opaqueDither` re-ramps the
	// listing's OWN hue, so the tile still carries the app's colour — it just covers
	// its box. (A caller that passes an `<AppIcon>` as `icon` is already safe: that
	// component sets its own glyph colour. This protects the raw-glyph callers.)
	const tileDither = opaqueDither(normalizeDither(dither));
	return (
		<div className="relative h-40 shrink-0 overflow-hidden sm:h-44">
			<DitherBanner
				banner={banner}
				dither={dither}
				fallback={fallback ?? iconBackground ?? null}
			/>
			{/* Scrim: the wash is author-supplied and can land anywhere on the
			    lightness range, so the title needs a floor it can read against
			    rather than relying on the colour being dark. Weighted toward the
			    BOTTOM two thirds — that is where the title, tagline and chips sit —
			    so the listing's own art still reads across the top of the band. */}
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-transparent"
			/>
			<div className="absolute inset-0 flex items-end gap-4 p-5 lg:px-7">
				<span
					className={cn(
						"relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white shadow-lg ring-1 ring-white/25 sm:size-20",
						tileDither || iconBackground ? undefined : "bg-background/20"
					)}
					style={iconBackground ? { background: iconBackground } : undefined}
				>
					{tileDither && !iconBackground ? (
						// Counter-direction wash, so the tile reads as a tile sitting ON
						// the hero rather than as a hole punched through it.
						<DitherGradient
							direction={OPPOSITE_DIRECTION[tileDither.direction ?? "up"]}
							from={tileDither.from}
							to={tileDither.to}
						/>
					) : null}
					<span className="relative flex items-center justify-center">
						{icon}
					</span>
				</span>
				<div className="min-w-0 flex-1 pb-0.5">
					{/* `truncate` sits on the INNER span, not the h2: the row has to be a
					    flex line so `nameBadge` keeps its width while the title alone
					    gives way. With `truncate` on the h2 the badge was clipped along
					    with the overflowing name. */}
					<h2 className="flex min-w-0 items-center gap-2 font-semibold text-white text-xl drop-shadow-md sm:text-2xl">
						<span className="truncate">{name}</span>
						{nameBadge}
					</h2>
					{tagline ? (
						<p className="line-clamp-2 text-sm text-white/85 drop-shadow sm:text-[0.9375rem]">
							{tagline}
						</p>
					) : null}
					{badges && badges.length > 0 ? (
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							{badges.map((badge) => (
								<span
									className="rounded-full bg-white/15 px-2 py-0.5 font-medium text-[11px] text-white/90 leading-4 backdrop-blur-sm"
									key={badge}
								>
									{badge}
								</span>
							))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

export interface ListingStat {
	icon?: IconSvgElement;
	/** Tiny uppercase caption — "VERSION", "DEVELOPER", "RATING". */
	label: string;
	/** Makes the whole cell a button — the rating cell jumps to the Reviews tab,
	 *  the health cell to Health. */
	onClick?: () => void;
	/** Optional second line under the value ("Ratings", "Updated 3d ago"). */
	sub?: ReactNode;
	/** The headline value. Kept short; a long one truncates rather than reflows. */
	value: ReactNode;
}

/** The divided meta row every app store puts directly under the hero. Replaces the
 *  inline flex-wrap `DetailMetaStrip` for the detail view: at 400px those items
 *  wrapped into an unreadable ribbon, and at 1200px they were a lonely single line
 *  of grey text where the store's headline facts should be. */
export function ListingStatStrip({ items }: { items: ListingStat[] }) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="overflow-x-auto border-border/60 border-y bg-muted/25">
			{/* No `min-w-max`: with it the row always took its NATURAL width, so a
			    long cell ("Runs on: Desktop, Island, Mobile") pushed the strip past
			    the dialog and clipped itself even at 1600px. Each cell keeps a
			    `min-w` floor instead — they share the space when there is room, and
			    the band scrolls only once the floors no longer fit. */}
			<div className="flex divide-x divide-border/60">
				{items.map((stat) => {
					const body = (
						<>
							<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
								{stat.label}
							</span>
							{/* The value gets its OWN truncating span rather than `truncate`
							    on this flex row: a bare text node inside a flex container is
							    an anonymous flex item and will not shrink below its
							    min-content width, so `truncate` on the row clipped nothing
							    and a long value ("Desktop, Island, Mobile") ran straight past
							    the dialog edge. */}
							<span className="flex w-full min-w-0 items-center justify-center gap-1 font-semibold text-foreground text-sm">
								{stat.icon ? (
									<HugeiconsIcon
										className="size-3.5 shrink-0"
										icon={stat.icon}
									/>
								) : null}
								<span className="truncate">{stat.value}</span>
							</span>
							{stat.sub ? (
								<span className="truncate text-[11px] text-muted-foreground">
									{stat.sub}
								</span>
							) : null}
						</>
					);
					const className =
						"flex min-w-[7.5rem] flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden px-4 py-3 text-center";
					return stat.onClick ? (
						<button
							className={cn(className, "transition-colors hover:bg-accent/60")}
							key={stat.label}
							onClick={stat.onClick}
							type="button"
						>
							{body}
						</button>
					) : (
						<div className={className} key={stat.label}>
							{body}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

/** The screenshot rail. Renders NOTHING when the listing ships no screenshots —
 *  which today is all but one packaged manifest — so a wide dialog never opens on
 *  an empty band where a gallery is implied. */
export function ListingGalleryRail({
	screenshots,
	name,
	onOpen,
}: {
	screenshots?: string[] | null;
	name: string;
	/** Opens the lightbox. Host-injected: the desktop ships one, web does not. */
	onOpen?: (index: number) => void;
}) {
	const safe = (screenshots ?? [])
		.map((url) => safeHttpUrl(url))
		.filter((url): url is string => Boolean(url));
	if (safe.length === 0) {
		return null;
	}
	return (
		<div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
			{safe.map((url, index) => {
				const frame = (
					<img
						alt={`${name} screenshot ${index + 1}`}
						className="h-48 w-auto max-w-none rounded-xl border border-border/60 object-cover sm:h-60"
						loading="lazy"
						src={url}
					/>
				);
				return onOpen ? (
					<button
						className="shrink-0 snap-start transition-opacity hover:opacity-90"
						key={url}
						onClick={() => onOpen(index)}
						type="button"
					>
						{frame}
					</button>
				) : (
					<span className="shrink-0 snap-start" key={url}>
						{frame}
					</span>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Body pieces
// ---------------------------------------------------------------------------

/** A titled block in either column. One heading treatment for all ten realms. */
export function ListingSection({
	title,
	icon,
	action,
	children,
}: {
	title: ReactNode;
	icon?: IconSvgElement;
	/** Trailing control on the heading row (a "see all", a toggle). */
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="flex items-center gap-1.5 font-medium text-sm">
					{icon ? (
						<HugeiconsIcon
							className="size-4 text-muted-foreground"
							icon={icon}
						/>
					) : null}
					{title}
				</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

/** A card in the right rail. Bordered rather than bare so the rail reads as
 *  reference material sitting beside the main column, not as a second body. */
export function ListingAsideCard({
	title,
	children,
}: {
	title?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-border/60 bg-muted/25 p-4">
			{title ? (
				<h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
					{title}
				</h3>
			) : null}
			{children}
		</div>
	);
}

export interface ListingInfoRow {
	label: string;
	value: ReactNode;
}

/** The Information table. A label/value grid rather than the old two-column flex
 *  row, so a long value (a licence name, a homepage host) wraps under its label
 *  instead of squeezing it to two characters. */
export function ListingInfoGrid({ rows }: { rows: ListingInfoRow[] }) {
	if (rows.length === 0) {
		return null;
	}
	return (
		<dl className="flex flex-col divide-y divide-border/60 text-sm">
			{rows.map((row) => (
				<div
					className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
					key={row.label}
				>
					<dt className="shrink-0 text-muted-foreground text-xs">
						{row.label}
					</dt>
					<dd className="min-w-0 truncate text-right font-medium text-xs">
						{row.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
