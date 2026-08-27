// apps/desktop/src/components/chat/AppLaunchpad.tsx
//
// The macOS-Launchpad grid on the empty chat start page: every app the user can
// actually open, as pages of icon tiles under the composer.
//
// Three decisions are load-bearing.
//
// WHAT IS LISTED. The source is `usePluginContributions().companions` — the
// full-page surfaces of ENABLED apps, already enabled-filtered server-side —
// narrowed further to `hasUi`. It is deliberately NOT the apps catalog: most
// feature apps are install-on-demand, and a sidecar-only app (`@ryu/social`) has no UI
// at all, so gridding the catalog would paint a dozen tiles that do nothing when
// clicked. If it has a tile here, it opens. Same list, same order, same launch
// call as the sidebar's Apps section — this is a second door onto that surface,
// not a second definition of it.
//
// HOW IT SCROLLS. Real Launchpad pages sideways, and that is also the only shape
// that fits here: the start page is a centred column inside the nested split-view
// tree, so a grid that grows DOWNWARD pushes the composer off-centre and clips
// against short panes. Paging horizontally pins the height at two rows whatever
// the app count, and the page size is MEASURED rather than assumed so a narrow
// split still gets whole pages instead of a half-cut column.
//
// WHY THE GRID IS SPLIT OUT. {@link AppLaunchpadGrid} takes its items as a prop
// and is exported, so `e2e/harness/app-launchpad-story.tsx` can mount the real
// component in real Chromium. The deliverable here is a laid-out, paginated grid —
// a rendered-geometry fact a type-check cannot see — and the hooks the wrapper
// uses need the app's whole node/provider tree, which a story cannot supply.
import AppIcon from "@ryu/marketplace/catalog/chrome/app-icon";
import { iconCacheKey } from "@ryu/marketplace/catalog/icon-cache";
import type { CardDither } from "@ryu/marketplace/catalog/types";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useApps } from "@/src/hooks/useApps.ts";
import {
	pluginCompanionPath,
	usePluginContributions,
} from "@/src/hooks/usePluginContributions.ts";

/** Two rows, like Launchpad's own grid — enough to read as a grid, short enough
 *  that the composer above it stays the centre of the page. */
const ROWS = 2;
/** Nominal tile footprint, used only to derive the column count from the measured
 *  width. The tiles themselves are `1fr`, so this sets density, not size. */
const TILE_WIDTH = 92;
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 8;

/** One tile. Everything the shared {@link AppIcon} needs to paint an app exactly
 *  as the sidebar and the Store paint it, plus the label and the launch id. */
export interface LaunchpadItem {
	/** Persisted icon-bytes key (`<id>@<version>`), so tiles paint offline. */
	cacheKey?: string | null;
	dither?: CardDither | null;
	iconBackground?: string | null;
	/** Icon-primitive id: the companion's own glyph, else the app's manifest art. */
	iconId?: string | null;
	/** Manifest-declared inset and letterbox treatment for icon art. */
	iconPadding?: string | null;
	iconUrl?: string | null;
	/** The companion id — what {@link pluginCompanionPath} routes to. */
	id: string;
	label: string;
	/** Generative-tile seed. ALWAYS the owning PLUGIN id, so an app that appears
	 *  in both the sidebar and here tiles identically in both. */
	seedId: string;
}

/** Column count that fits `width`, clamped so a very narrow split still gets a
 *  grid and a very wide one does not spread into a single sparse row. */
function columnsForWidth(width: number): number {
	if (width <= 0) {
		return MIN_COLUMNS;
	}
	const fits = Math.floor(width / TILE_WIDTH);
	return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fits));
}

function chunk<T>(items: T[], size: number): T[][] {
	const pages: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		pages.push(items.slice(i, i + size));
	}
	return pages;
}

export interface AppLaunchpadGridProps {
	className?: string;
	items: LaunchpadItem[];
	/** `newTab` is true for a middle-click, matching the sidebar's Apps rows. */
	onOpen: (item: LaunchpadItem, newTab: boolean) => void;
}

/**
 * The presentational grid. Renders nothing for an empty list, so the start page
 * never grows a stray strip under the composer for a user whose apps are all off.
 */
export function AppLaunchpadGrid({
	className,
	items,
	onOpen,
}: AppLaunchpadGridProps) {
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	const [page, setPage] = useState(0);

	const columns = columnsForWidth(width);
	const pages = useMemo(() => chunk(items, columns * ROWS), [items, columns]);

	// `useLayoutEffect`, not `useEffect`: the column count is derived from a
	// measurement, and the pre-measurement value is `MIN_COLUMNS`. Measuring after
	// paint would show every new chat a 3-column grid for one frame before it
	// re-chunked to the 7 that fit — a visible pop on the start page.
	useLayoutEffect(() => {
		const el = scrollerRef.current;
		if (!el) {
			return;
		}
		setWidth(el.clientWidth);
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Re-measuring changes the page size, so a stale index can point past the end.
	useEffect(() => {
		setPage((current) => Math.min(current, Math.max(0, pages.length - 1)));
	}, [pages.length]);

	const handleScroll = useCallback(() => {
		const el = scrollerRef.current;
		if (!el || el.clientWidth === 0) {
			return;
		}
		setPage(Math.round(el.scrollLeft / el.clientWidth));
	}, []);

	const goToPage = useCallback((index: number) => {
		const el = scrollerRef.current;
		if (!el) {
			return;
		}
		el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
	}, []);

	if (items.length === 0) {
		return null;
	}

	return (
		// Deliberately NOT height-constrained. An earlier revision tried to make this
		// the child that gives way in a short pane (`min-h-0` + `1fr` rows), which
		// does nothing: `1fr` resolves against a definite height, and the scroller
		// above it is height-auto, so the tiles simply spilled and were sliced in
		// half by the pane edge. The start-page column scrolls instead — see the
		// `my-auto` note in `agent-chat.tsx`.
		<div className={cn("mt-4 w-full", className)}>
			{/* `overflow-x-auto` with mandatory snapping: a trackpad swipe lands on a
			    whole page, exactly as Launchpad does. The scrollbar is hidden because
			    the dots below already say where you are. */}
			<div
				className="scroll-fade-x flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				data-testid="launchpad-scroller"
				onScroll={handleScroll}
				ref={scrollerRef}
			>
				{pages.map((pageItems) => (
					<div
						className="grid w-full shrink-0 snap-start gap-x-1 gap-y-2"
						data-testid="launchpad-page"
						key={pageItems[0]?.id ?? "page"}
						style={{
							gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
							gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
						}}
					>
						{pageItems.map((item) => (
							<button
								className="group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors hover:bg-muted/60"
								key={item.id}
								onAuxClick={(e) => {
									if (e.button === 1) {
										e.preventDefault();
										onOpen(item, true);
									}
								}}
								onClick={() => onOpen(item, false)}
								title={item.label}
								type="button"
							>
								{/* Identical resolution order and seed to the sidebar's Apps
								    rows and the Store's cards, so one app tiles the same way
								    wherever it is seen. */}
								<AppIcon
									cacheKey={item.cacheKey}
									className="size-12 rounded-[12px] transition-transform group-active:scale-95"
									dither={item.dither}
									iconBackground={item.iconBackground}
									iconId={item.iconId}
									iconPadding={item.iconPadding}
									iconUrl={item.iconUrl}
									name={item.label}
									seedId={item.seedId}
									size={22}
								/>
								<span className="w-full truncate text-center text-[11px] text-muted-foreground leading-tight group-hover:text-foreground">
									{item.label}
								</span>
							</button>
						))}
					</div>
				))}
			</div>

			{pages.length > 1 ? (
				<div className="mt-2 flex items-center justify-center gap-1.5">
					{pages.map((pageItems, index) => (
						<button
							aria-label={`Apps page ${index + 1}`}
							className={cn(
								"size-1.5 rounded-full transition-colors",
								index === page ? "bg-foreground/60" : "bg-foreground/20"
							)}
							key={pageItems[0]?.id ?? `page-${index}`}
							onClick={() => goToPage(index)}
							type="button"
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

export interface AppLaunchpadProps {
	className?: string;
}

/** Wires the grid to the live contribution list and to `openTab`. */
export function AppLaunchpad({ className }: AppLaunchpadProps) {
	const { companions } = usePluginContributions();
	const { apps } = useApps();
	const { openTab } = useTabsContext();

	// The owning app of each companion, so a tile paints the app's real manifest
	// art. A companion contribution carries only its own optional `icon`; most
	// apps declare their icon on the MANIFEST, which is why a list keyed on the
	// contribution alone falls through to one repeated glyph.
	const appsById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

	const items = useMemo<LaunchpadItem[]>(
		() =>
			companions
				.filter((c) => c.hasUi !== false)
				.map((c) => {
					const owner = c.pluginId ? appsById.get(c.pluginId) : undefined;
					const seedId = c.pluginId || c.id;
					return {
						cacheKey: iconCacheKey(
							seedId,
							owner?.installedVersion ?? owner?.version
						),
						dither: owner?.iconDither,
						iconBackground: owner?.iconBackground,
						iconId: c.icon ?? owner?.icon,
						iconPadding: owner?.iconPadding,
						iconUrl: owner?.iconUrl,
						id: c.id,
						label: c.label || c.name,
						seedId,
					};
				}),
		[companions, appsById]
	);

	const handleOpen = useCallback(
		(item: LaunchpadItem, newTab: boolean) => {
			openTab(pluginCompanionPath(item.id), {
				title: item.label,
				forceNew: newTab,
			});
		},
		[openTab]
	);

	return (
		<AppLaunchpadGrid className={className} items={items} onOpen={handleOpen} />
	);
}

export default AppLaunchpad;
