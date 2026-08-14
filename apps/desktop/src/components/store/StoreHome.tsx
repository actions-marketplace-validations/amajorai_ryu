// apps/desktop/src/components/store/StoreHome.tsx
//
// The Store's "Home" section — an app-store landing feed centered in the same
// max-width column as every other catalog tab, so its header lines up with them.
// It is a stack of shelves, all built the same way: a StoreShelfHeading over a
// 2-column grid of the SAME card the catalog tabs render (StoreCatalogCard). The
// curated "Featured" shelf is the first of them and nothing more — it used to be
// a giant auto-advancing dither carousel, a second layout that only Home had.
//
// It routes AND it adds. Clicking a card opens that realm's own section with the
// clicked item's PREVIEW already open, and the card's action adds it in place
// through the realm's one-call add (`HomeRow.add`). Home used to be router-ONLY,
// which read as a landing page you could not do anything from: six shelves of
// things to add, no way to add any.
//
// "Pre-selected" was a claim this comment made and the code did not honour. Every
// shelf card passed the item's NAME into `onOpenRealm`, and the shell's only sink
// for that argument is `sectionInitialQuery` — the destination's SEARCH BOX. So
// clicking a card ran a text search for its title, which is why an item whose name
// is a common word landed you on a filtered list rather than on the thing you
// pointed at. The shelves pass the item's ID now, and the shell threads it to the
// section as `initialSelectedId`.
//
// Anything needing a decision (grants, quant choice, enable) still routes: this
// button does the one unambiguous thing, and the realm tab owns the rest.

import {
	ArrowRight01Icon,
	CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InstallProgressButton } from "@ryu/blocks/desktop/install-button.tsx";
import StoreCatalogCard from "@ryu/marketplace/catalog/chrome/store-catalog-card";
import { StoreCardGrid } from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import { storeItemContextMenu } from "@ryu/marketplace/catalog/chrome/store-item-action";
import StoreShelfHeading from "@ryu/marketplace/catalog/chrome/store-shelf-heading";
import { Button } from "@ryu/ui/components/button.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import {
	type HomeCard,
	type HomeFeaturedItem,
	type HomeRow,
	useStoreHome,
} from "@/src/hooks/useStoreHome.ts";
import type { StoreSearchRealm } from "@/src/hooks/useStoreSearch.ts";
import { AgentCatalogLogo } from "@/src/lib/agent-catalog-logo.tsx";
import { useInstallingLookup } from "@/src/store/useInstallStore.ts";

/** First letter of a name as a fallback glyph, matching the catalog card's icon
 *  square treatment (a muted rounded square with the initial). */
function initialGlyph(name: string) {
	return (
		<span className="font-medium text-muted-foreground text-sm uppercase">
			{name.trim().charAt(0) || "?"}
		</span>
	);
}

export default function StoreHome({
	onOpenRealm,
}: {
	/** Open a realm's section. `query` seeds its search box; `itemId` opens that
	 *  item's preview. A shelf card passes an id and no query; the Featured shelf
	 *  is the one caller that still passes a name (see {@link FeaturedSection}). */
	onOpenRealm: (
		realm: StoreSearchRealm,
		query: string,
		itemId?: string
	) => void;
}) {
	const { featured, rows, loading } = useStoreHome();

	return (
		<div className="scroll-fade-effect-y h-full overflow-auto">
			{/* No title here — the Store's page chrome (StorePage) renders the
			    section title for every tab, including this one. */}
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 pt-2 pb-12">
				{featured.length > 0 ? (
					<FeaturedSection items={featured} onOpenRealm={onOpenRealm} />
				) : null}

				{loading && rows.length === 0 ? (
					<div className="flex items-center justify-center py-10 text-muted-foreground">
						<Spinner className="size-5" />
					</div>
				) : (
					rows.map((row) => (
						<HomeSection
							key={row.realm}
							onOpenItem={(id) => onOpenRealm(row.realm, "", id)}
							onOpenRow={() => onOpenRealm(row.realm, "")}
							row={row}
						/>
					))
				)}
			</div>
		</div>
	);
}

/** The curated cross-kind shelf, rendered exactly like every realm shelf below
 *  it: heading + the shared card grid. It has no "See all" because its items
 *  span realms — there is no single tab that holds all of them — and no Add
 *  button because a featured card carries no installed state and no realm add
 *  (the money layer's card shape has neither); the click routes to the item in
 *  its own realm, where the full lifecycle lives.
 *
 *  It is also the ONE shelf that still routes by NAME rather than by id. A
 *  featured entry is a marketplace `MarketplaceCard`, keyed in the control
 *  plane's `(kind, id)` space — a different namespace from the node-realm
 *  catalog ids every section's `select()` expects. Handing that id over as a
 *  preselect would silently select nothing; a name-seeded search is the honest
 *  fallback here, and only here. */
function FeaturedSection({
	items,
	onOpenRealm,
}: {
	items: HomeFeaturedItem[];
	onOpenRealm: (
		realm: StoreSearchRealm,
		query: string,
		itemId?: string
	) => void;
}) {
	return (
		<section>
			<StoreShelfHeading className="px-0">Featured</StoreShelfHeading>
			<StoreCardGrid>
				{/* Same six-card cap as every realm shelf, so the front page is a
				    uniform stack rather than one shelf three rows taller. */}
				{items.slice(0, 6).map((item) => (
					<StoreCatalogCard
						description={item.card.description}
						icon={initialGlyph(item.card.name)}
						iconUrl={item.card.iconUrl}
						key={`${item.card.kind}:${item.card.id}`}
						// The heart, keyed on the listing's public scoped id — the same
						// key the realm tabs and the web store count on, so a like made
						// here is the same like everywhere. Home used to be the one
						// surface rendering this card with no like control at all.
						// No seed: the desktop's catalog client does not carry per-card
						// counts, so the shared provider batch-resolves the whole shelf in
						// ONE request rather than one per card.
						likeNamespace={item.card.id}
						name={item.card.name}
						onClick={() => onOpenRealm(item.realm, item.card.name)}
						seedId={item.card.id}
					/>
				))}
			</StoreCardGrid>
		</section>
	);
}

function HomeSection({
	row,
	onOpenRow,
	onOpenItem,
}: {
	row: HomeRow;
	/** "See all" — open the realm with no query. */
	onOpenRow: () => void;
	/** Open the realm with one item's preview already open. */
	onOpenItem: (id: string) => void;
}) {
	// One subscription for the whole shelf, shared with every other store surface:
	// an add started here and the same item's card in its realm tab read the same
	// flag, so Home is not a sixth private owner of "installing".
	const isInstalling = useInstallingLookup();
	return (
		<section>
			<StoreShelfHeading
				action={
					<span className="flex items-center gap-0.5 text-muted-foreground text-xs transition-colors group-hover:text-foreground">
						See all
						<HugeiconsIcon className="size-3.5" icon={ArrowRight01Icon} />
					</span>
				}
				className="px-0"
				onOpen={onOpenRow}
			>
				{row.label}
			</StoreShelfHeading>
			<StoreCardGrid>
				{row.items.slice(0, 6).map((item: HomeCard) => (
					<StoreCatalogCard
						action={
							<HomeCardAction
								busy={isInstalling(item.id)}
								installed={item.installed}
								onAdd={() => {
									row.add(item).catch(() => {
										// The realm tab owns error presentation; a failed add here
										// just releases the button so it can be retried.
									});
								}}
							/>
						}
						// The AGENTS row renders the same themed brand mark the Agents tab
						// does, instead of the agent's raw CDN icon. Those marks are solid
						// black SVGs, so Claude and Codex were black-on-black here on a dark
						// theme — the one row where Home bypassed the component that already
						// pairs a light/dark asset per branded engine and `dark:invert`s the
						// rest. `brandIcon` reaches AppIcon as its `fallback`, which
						// suppresses the generative tile exactly the way a real icon does.
						brandIcon={
							row.realm === "agents" ? (
								<AgentCatalogLogo
									entry={{
										engine: item.engine ?? null,
										id: item.id,
										name: item.name,
										registryId: item.registryId ?? null,
									}}
									size="40px"
								/>
							) : undefined
						}
						// The one verb this shelf's card has. An already-added row renders
						// no menu at all rather than an empty one — Home is a discovery
						// shelf, and managing what you added is the realm tab's job.
						contextMenu={storeItemContextMenu({
							installed: item.installed,
							onInstall: () => {
								row.add(item).catch(() => {
									// The realm tab owns error presentation.
								});
							},
						})}
						description={item.description}
						// Home renders the SAME card component as the realm tabs, so it must
						// also feed it the same icon inputs. Passing only `iconUrl` (which is
						// null for every app and plugin) sent every row to the generative
						// placeholder, and made Home — the first tab anyone opens — the one
						// place the store's icons were wrong.
						dither={item.dither}
						icon={initialGlyph(item.name)}
						iconId={item.iconId}
						iconUrl={item.iconUrl}
						key={item.id}
						// Same heart as the realm tab's card, keyed the same way — Home was
						// the one place this card rendered without one.
						likeNamespace={item.id}
						name={item.name}
						// The clicked ITEM's PREVIEW, not a search for its title. `item.id` is
						// the same id the realm's own catalog hook keys its `select()` on —
						// both sides fetch through the same per-realm client function — so
						// the destination opens on the thing that was pointed at.
						onClick={() => onOpenItem(item.id)}
						seedId={item.id}
					/>
				))}
			</StoreCardGrid>
		</section>
	);
}

/** A Home row's action: Add, or a static "Added" pill.
 *
 *  Deliberately not `StoreItemAction`: that control answers an installed item
 *  with a 3-dot lifecycle menu, and Home has no lifecycle to offer — no enable,
 *  no remove, no settings. An empty menu is worse than no menu. */
function HomeCardAction({
	installed,
	busy,
	onAdd,
}: {
	busy: boolean;
	installed: boolean;
	onAdd: () => void;
}) {
	if (installed) {
		return (
			<Button className="shrink-0" disabled size="sm" variant="secondary">
				<HugeiconsIcon
					className="size-3.5 text-success"
					icon={CheckmarkCircle02Icon}
				/>
				Added
			</Button>
		);
	}
	return (
		<InstallProgressButton
			className="shrink-0"
			idleVariant="default"
			installing={busy}
			onClick={onAdd}
		>
			Add
		</InstallProgressButton>
	);
}
