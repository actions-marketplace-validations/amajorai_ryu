import {
	Add01Icon,
	BookOpen01Icon,
	CheckmarkCircle02Icon,
	Download01Icon,
	GridIcon,
	InformationCircleIcon,
	LayoutGridIcon,
	Link01Icon,
	PackageIcon,
	Robot01Icon,
	ServerStack01Icon,
	Settings01Icon,
	SquareLock01Icon,
	WorkflowSquare01Icon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ryu/ui/components/alert-dialog.tsx";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty.tsx";
import { Icon } from "@ryu/ui/components/icon.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@ryu/ui/components/popover.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useSvglIndex } from "@ryu/ui/components/svgl.ts";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMarketplaceHostOptional } from "../host.tsx";
import { useOptionalReport } from "../report/report-provider.tsx";
import { StarRating } from "../star-rating.tsx";
import { formatPrice } from "../types.ts";
import { groupByCategory } from "./categories.ts";
import BrandOrCoverImage from "./chrome/brand-image.tsx";
import CommunityTrustNotice from "./chrome/community-trust-notice.tsx";
import InfiniteSentinel from "./chrome/infinite-sentinel.tsx";
import StoreCatalogCard from "./chrome/store-catalog-card.tsx";
import StoreCatalogLayout, {
	StoreCardGrid,
} from "./chrome/store-catalog-layout.tsx";
import StoreItemAction, {
	StoreItemContextMenuContent,
	StoreItemOverflowMenu,
} from "./chrome/store-item-action.tsx";
import VerifiedBadge from "./chrome/verified-badge.tsx";
import { formatCount, formatDate } from "./detail/detail-panels.tsx";
import {
	ListingAsideCard,
	ListingDetailShell,
	ListingGalleryRail,
	ListingHero,
	ListingInfoGrid,
	ListingSection,
	type ListingStat,
	ListingStatStrip,
} from "./detail/listing-detail-shell.tsx";
import { ListingDetailTabs } from "./detail/listing-detail-tabs.tsx";
import { ScorecardBadge } from "./detail/scorecard-panel.tsx";
import { grantDescription, grantLabel } from "./grant-labels.ts";
import {
	type CatalogHost,
	type CatalogInstall,
	type PluginSettingsOpener,
	useCatalogHost,
	useNoSettingsOpener,
} from "./host.tsx";
import { resolveCardIcon } from "./icon-url.ts";
import ImportToolsAction from "./import-tools-action.tsx";
import { REALM_ICONS } from "./realm-icons.ts";
import { safeHttpUrl } from "./safe-url.ts";
import { runScorecard, type Scorecard } from "./scorecard.ts";
import { stabilityLabel } from "./stability.ts";
import { surfaceLabel } from "./surface-labels.ts";
import type {
	AddMarketplaceParams,
	AppCatalogItem,
	CatalogEntry,
	PluginCatalogDetail,
	PluginCatalogSource,
} from "./types.ts";

/** Which slice of the plugin catalog a section instance browses. An "app" is a
 *  plugin that bundles a Companion runnable (a full-page UI surface); a "plugin"
 *  is everything else (tools/agents/channels/policies). "all" = the historical
 *  unsplit tab, which web still uses.
 *
 *  There is no "community" variant any more. Community listings are not a
 *  different KIND of thing — they are apps and plugins that nobody at Ryu
 *  reviewed — so a whole tab for them split the catalog by provenance and asked
 *  the user to visit two places to answer one question ("is there a Ryu plugin
 *  for X?"). They are now a trailing, clearly-labelled shelf inside these same
 *  tabs; see {@link CommunityShelf}. */
export type AppsCatalogVariant = "apps" | "plugins" | "all";

/** True when a catalog entry is an "app". Prefers the explicit `type` discriminator
 *  the catalog now emits; falls back to the legacy "ships a Companion runnable"
 *  derivation for older wires that don't carry `type`.
 *  Exported for unit tests (the detail-panel helpers below run only inside the
 *  Dialog-portaled preview, which `renderToStaticMarkup` cannot emit). */
export function isCompanionApp(item: AppCatalogItem): boolean {
	if (item.entry.type) {
		return item.entry.type === "app";
	}
	return item.entry.kinds.includes("companion");
}

/** True when a listing was discovered from a public GitHub topic rather than
 *  published to a first-party catalog — i.e. nobody at Ryu reviewed it.
 *
 *  Keys on the snake_case `origin` the Core projector stamps (see
 *  `plugin_marketplace_item_to_entry`); `reviewed === false` is accepted as a
 *  secondary signal so a source that stamps only the trust flag still gets the
 *  notice. Absent/null ⇒ first-party: deliberately fail-safe in that direction so
 *  an older wire never gains a scary label, which makes the notice opt-in from the
 *  producer. Exported for unit tests. */
export function isCommunityEntry(item: AppCatalogItem): boolean {
	return item.entry.origin === "community" || item.entry.reviewed === false;
}

const VARIANT_COPY: Record<
	AppsCatalogVariant,
	{ noun: string; nounPlural: string; searchPlaceholder: string }
> = {
	apps: {
		noun: "app",
		nounPlural: "apps",
		searchPlaceholder: "Search apps…",
	},
	plugins: {
		noun: "plugin",
		nounPlural: "plugins",
		searchPlaceholder: "Search plugins…",
	},
	all: {
		noun: "plugin",
		nounPlural: "plugins",
		searchPlaceholder: "Search plugins…",
	},
};

/**
 * Plugins catalog Store section, shared by desktop and web. Browses the active
 * catalog source (Ryu Marketplace by default, or integrations.sh) joined with
 * live lifecycle records, and drives install → enable → disable for signed
 * plugins. Integration descriptors are browse-only with an outbound link.
 *
 * Desktop mounts it twice — variant "apps" (companion-UI apps) and "plugins"
 * (everything else) — while web keeps the unsplit "all" default. A third mount,
 * variant "community", browses GitHub topic-discovered third-party listings; it
 * is a SEPARATE fetch (Core keeps unreviewed listings out of the first-party
 * catalog) and always renders the "not reviewed by Ryu" notice.
 *
 * Desktop injects its real Core-node catalog hook + install layer through the
 * {@link CatalogHost}; web injects a federated adapter with `install: null`, so
 * the install/enable/source touchpoints collapse to an "Open in Ryu" affordance.
 */
export default function AppsCatalogSection({
	initialQuery = "",
	variant = "all",
}: {
	/** Seed the search box (e.g. carried over from the store-wide search). */
	initialQuery?: string;
	/** Catalog slice: companion "apps", non-companion "plugins", or "all". */
	variant?: AppsCatalogVariant;
} = {}) {
	const host = useCatalogHost();
	// One resolver for the whole section, threaded down to the cards + detail
	// header. Called here rather than per card because a host implementation reads
	// live node state to answer it — per card that would be one fetch per row.
	// The host is a stable per-surface value, so this branch never flips between
	// renders on a given surface (rules of hooks).
	const usePluginSettingsOpener =
		host.usePluginSettingsOpener ?? useNoSettingsOpener;
	const settingsOpener = usePluginSettingsOpener();
	const {
		items,
		loading,
		loadingMore,
		error,
		fetchNextPage,
		hasNextPage,
		query,
		setQuery,
		selectedId,
		select,
		selectedItem,
		detail,
		detailLoading,
		detailError,
		install,
		installing,
		setEnabled,
		lifecyclePending,
		installFromUrl,
		sources,
		activeSource,
		selectSource,
		selectingSource,
		addMarketplace,
		addingMarketplace,
	} = host.useAppsCatalog(initialQuery);

	// Community listings ride the SAME tab, from a second fetch. Core keeps
	// unreviewed topic-discovered listings out of the first-party catalog, so they
	// cannot be filtered INTO this page — `origin: "community"` addresses that feed
	// directly. They then render as a trailing shelf under their own heading and
	// trust notice, instead of the separate Store tab they used to need.
	const community = host.useAppsCatalog(initialQuery, { origin: "community" });

	// One search box, two feeds. The community hook owns its own debounce, so it is
	// driven from the primary query rather than given its own input.
	const communitySetQuery = community.setQuery;
	useEffect(() => {
		communitySetQuery(query);
	}, [query, communitySetQuery]);

	// The apps/plugins split is presentational: one shared catalog fetch, filtered
	// per variant. Integration descriptors (integrations.sh) stay on the plugins side.
	//
	// The `isCommunityEntry` guard on the first-party list is belt-and-braces: those
	// rows come from the community fetch below, so one appearing here would mean a
	// source leaked it — and it must not render without its trust notice.
	const splitForVariant = (it: AppCatalogItem) => {
		if (variant === "all") {
			return true;
		}
		return variant === "apps" ? isCompanionApp(it) : !isCompanionApp(it);
	};
	const visibleItems = items.filter(
		(it) => !isCommunityEntry(it) && splitForVariant(it)
	);
	const communityItems = community.items
		.filter(isCommunityEntry)
		.filter(splitForVariant);
	const copy = VARIANT_COPY[variant];

	// Which feed owns the current selection. The two hooks each track their own
	// `selectedId`, so opening a community listing must both point the preview at
	// the community hook AND clear the first-party one — otherwise two rows would
	// render as selected and the preview would show whichever hook won.
	const [communitySelected, setCommunitySelected] = useState(false);
	const active = communitySelected ? community : null;
	const selectFirstParty = (id: string) => {
		setCommunitySelected(false);
		community.select("");
		select(id);
	};
	const selectCommunity = (id: string) => {
		setCommunitySelected(true);
		select("");
		community.select(id);
	};
	const closeDetail = () => {
		setCommunitySelected(false);
		community.select("");
		select("");
	};

	// Per-card lifecycle without a per-id hook: the hook's install()/setEnabled()
	// act on the SELECTED item, so a card action selects its item and defers the
	// call until the selection lands (non-racy — the effect fires only once
	// selectedId matches). Install + Disable run inline; Enable routes to the
	// preview so its grant-confirmation dialog is never bypassed.
	const [pending, setPending] = useState<{
		id: string;
		action: "install" | "disable";
	} | null>(null);

	useEffect(() => {
		if (!pending || selectedId !== pending.id) {
			return;
		}
		const run =
			pending.action === "install" ? install : () => setEnabled(false);
		run().catch(() => {
			// Errors surface through the hook's error state in the detail panel.
		});
		setPending(null);
	}, [pending, selectedId, install, setEnabled]);

	const cardInstall = (id: string) => {
		setPending({ id, action: "install" });
		selectFirstParty(id);
	};
	const cardDisable = (id: string) => {
		setPending({ id, action: "disable" });
		selectFirstParty(id);
	};

	const filter = host.install
		? {
				label: "Source & install",
				icon: Link01Icon,
				panel: (
					<div className="flex flex-col gap-4 p-4">
						<PluginSourcePicker
							activeSource={activeSource}
							addingMarketplace={addingMarketplace}
							addMarketplace={addMarketplace}
							selectingSource={selectingSource}
							selectSource={selectSource}
							sources={sources}
						/>
						<InstallFromUrl install={installFromUrl} />
					</div>
				),
			}
		: undefined;

	return (
		<StoreCatalogLayout
			detail={
				<AppDetailPanel
					detail={active ? active.detail : detail}
					detailError={active ? active.detailError : detailError}
					detailLoading={active ? active.detailLoading : detailLoading}
					error={active ? active.error : error}
					install={active ? active.install : install}
					installing={active ? active.installing : installing}
					installLayer={host.install}
					item={active ? active.selectedItem : selectedItem}
					lifecyclePending={active ? active.lifecyclePending : lifecyclePending}
					noun={copy.noun}
					renderAffordance={host.renderAffordance}
					selectedId={active ? active.selectedId : selectedId}
					setEnabled={active ? active.setEnabled : setEnabled}
					settingsOpener={settingsOpener}
				/>
			}
			detailTitle={
				(active ? active.selectedItem : selectedItem)?.entry.name ?? copy.noun
			}
			filter={filter}
			hasSelection={(active ? active.selectedItem : selectedItem) != null}
			list={
				<AppList
					canInstall={host.install != null}
					communityFetchNextPage={community.fetchNextPage}
					communityHasNextPage={community.hasNextPage}
					communityItems={communityItems}
					communityLoading={community.loading}
					communitySelectedId={communitySelected ? community.selectedId : null}
					error={error}
					fallbackIcon={REALM_ICONS[variant === "plugins" ? "plugins" : "apps"]}
					fetchNextPage={fetchNextPage}
					hasNextPage={hasNextPage}
					items={visibleItems}
					loading={loading}
					loadingMore={loadingMore}
					nounPlural={copy.nounPlural}
					onDisable={cardDisable}
					onInstall={cardInstall}
					onSelect={selectFirstParty}
					onSelectCommunity={selectCommunity}
					pendingId={pending?.id ?? null}
					searching={query.trim().length > 0}
					selectedId={communitySelected ? null : selectedId}
					settingsOpener={settingsOpener}
				/>
			}
			onCloseDetail={closeDetail}
			search={{
				value: query,
				onChange: setQuery,
				placeholder:
					activeSource === "integrations-sh"
						? "Search integrations (MCP, OpenAPI, GraphQL, CLI)…"
						: copy.searchPlaceholder,
			}}
		/>
	);
}

/**
 * Source dropdown (Ryu Marketplace + any custom Claude plugin marketplaces) plus
 * an "Add marketplace" popover. A marketplace is just a repo/URL pointing at a
 * `.claude-plugin/marketplace.json`.
 */
function PluginSourcePicker({
	sources,
	activeSource,
	selectSource,
	selectingSource,
	addMarketplace,
	addingMarketplace,
}: {
	sources: PluginCatalogSource[];
	activeSource: string;
	selectSource: (id: string) => void;
	selectingSource: boolean;
	addMarketplace: (params: AddMarketplaceParams) => Promise<void>;
	addingMarketplace: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [repo, setRepo] = useState("");
	const [name, setName] = useState("");
	const [addError, setAddError] = useState<string | null>(null);

	const sourceItems = sources.map((s) => ({
		value: s.id,
		label: s.displayName,
	}));

	const submit = async () => {
		const trimmedRepo = repo.trim();
		if (!trimmedRepo) {
			setAddError("Enter a repo or marketplace.json URL");
			return;
		}
		const displayName = name.trim() || trimmedRepo;
		// Derive a stable, safe id from the display name / repo.
		const id = `mp-${displayName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")}`;
		setAddError(null);
		try {
			await addMarketplace({ id, displayName, baseUrl: trimmedRepo });
			setRepo("");
			setName("");
			setOpen(false);
		} catch (e) {
			setAddError(e instanceof Error ? e.message : "Failed to add marketplace");
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<span className="font-medium text-muted-foreground text-xs">
				Catalog source
			</span>
			{sources.length > 1 && (
				<Select
					disabled={selectingSource}
					items={sourceItems}
					onValueChange={(value) => {
						if (value) {
							selectSource(value);
						}
					}}
					value={activeSource}
				>
					<SelectTrigger className="h-8 w-full text-sm" size="sm">
						<SelectValue placeholder="Source" />
					</SelectTrigger>
					<SelectContent>
						{sourceItems.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			<Popover onOpenChange={setOpen} open={open}>
				<TooltipProvider delay={0}>
					<Tooltip>
						<TooltipTrigger
							render={
								<PopoverTrigger className="inline-flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground">
									<HugeiconsIcon className="size-4" icon={Add01Icon} />
									Add marketplace
								</PopoverTrigger>
							}
						/>
						<TooltipContent>Add a Claude plugin marketplace</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				<PopoverContent className="w-80">
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1">
							<Label htmlFor="plugin-mp-repo">
								Repo or marketplace.json URL
							</Label>
							<Input
								id="plugin-mp-repo"
								onChange={(e) => setRepo(e.target.value)}
								placeholder="owner/repo or https://…/marketplace.json"
								value={repo}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="plugin-mp-name">Display name (optional)</Label>
							<Input
								id="plugin-mp-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="My Marketplace"
								value={name}
							/>
						</div>
						{addError && <p className="text-destructive text-xs">{addError}</p>}
						<Button
							disabled={addingMarketplace}
							onClick={() => {
								submit().catch(() => undefined);
							}}
							size="sm"
						>
							{addingMarketplace ? (
								<Spinner className="size-4" />
							) : (
								<HugeiconsIcon className="size-4" icon={Add01Icon} />
							)}
							{addingMarketplace ? "Adding…" : "Add marketplace"}
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function InstallFromUrl({
	install,
}: {
	install: (url: string) => Promise<void>;
}) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);

	// Fire-and-forget: all errors are handled inside, so the returned promise
	// never rejects and callers can invoke it without awaiting or `void`.
	const submit = () => {
		const trimmed = url.trim();
		if (!trimmed || busy) {
			return;
		}
		setBusy(true);
		install(trimmed)
			.then(() => setUrl(""))
			.catch(() => {
				// Error surfaces via the hook's error state in the detail panel; the
				// input stays populated so the user can correct the URL.
			})
			.finally(() => setBusy(false));
	};

	return (
		<div className="flex items-center gap-2">
			<div className="relative flex-1">
				<HugeiconsIcon
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					icon={Link01Icon}
				/>
				<Input
					className="pl-9"
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							submit();
						}
					}}
					placeholder="https://…/manifest.json"
					value={url}
				/>
			</div>
			<Button
				disabled={busy || url.trim().length === 0}
				onClick={submit}
				size="sm"
				variant="outline"
			>
				{busy ? <Spinner className="size-4" /> : "Install from URL"}
			</Button>
		</div>
	);
}

function AppList({
	items,
	loading,
	loadingMore,
	error,
	selectedId,
	onSelect,
	onInstall,
	onDisable,
	pendingId,
	canInstall,
	fetchNextPage,
	hasNextPage,
	nounPlural,
	fallbackIcon,
	searching,
	communityItems,
	communityLoading,
	communityHasNextPage,
	communityFetchNextPage,
	communitySelectedId,
	onSelectCommunity,
	settingsOpener,
}: {
	items: AppCatalogItem[];
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onInstall: (id: string) => void;
	onDisable: (id: string) => void;
	pendingId: string | null;
	canInstall: boolean;
	fetchNextPage: () => void;
	hasNextPage: boolean;
	nounPlural: string;
	/** Realm glyph shown when an item has no icon of its own (apps→grid,
	 *  plugins→puzzle), sourced from the shared REALM_ICONS so it matches the tab. */
	fallbackIcon: IconSvgElement;
	/** Unreviewed GitHub topic-discovered listings, already narrowed to this tab's
	 *  apps/plugins slice. Rendered as a trailing shelf under their own heading and
	 *  trust notice — see {@link CommunityShelf}. */
	communityItems: AppCatalogItem[];
	communityLoading: boolean;
	communityHasNextPage: boolean;
	communityFetchNextPage: () => void;
	/** Selected community row, or null when the selection belongs to the
	 *  first-party feed (the two feeds each track their own selection). */
	communitySelectedId: string | null;
	onSelectCommunity: (id: string) => void;
	/** True while the user has a search query typed. Suppresses category shelves —
	 *  a result list is ranked by relevance, and slicing it into headed sections
	 *  fights that. */
	searching?: boolean;
	/** Resolves a listing to its "open settings" action (see the host seam). */
	settingsOpener: PluginSettingsOpener;
}) {
	const reportCtx = useOptionalReport();
	const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

	const card = (it: AppCatalogItem) => (
		<StoreCatalogCard
			action={
				<AppCardAction
					canInstall={canInstall}
					item={it}
					onDisable={() => onDisable(it.entry.id)}
					onInstall={() => onInstall(it.entry.id)}
					onOpen={() => onSelect(it.entry.id)}
					// Settings are keyed by the MANIFEST id, and `entry.id` IS that id
					// for any installed listing: the catalog↔record join matches on
					// it, which is what makes the row read "installed" at all.
					onOpenSettings={settingsOpener(it.entry.id)}
					pending={pendingId === it.entry.id}
				/>
			}
			contextMenu={
				!it.installed && canInstall ? (
					<StoreItemContextMenuContent
						canReport={Boolean(reportTargetForApp(it))}
						onInstall={() => onInstall(it.entry.id)}
						onReport={() => reportCtx?.open(reportTargetForApp(it))}
					/>
				) : undefined
			}
			description={it.entry.description}
			dither={it.entry.icon_dither}
			icon={<HugeiconsIcon className="size-5" icon={fallbackIcon} />}
			iconBackground={it.entry.icon_background ?? undefined}
			iconId={it.entry.icon}
			iconUrl={it.entry.icon_url}
			key={it.entry.id}
			name={it.entry.name}
			onClick={() => onSelect(it.entry.id)}
			orgVerified={it.entry.org_verified}
			orgVerifiedTier={it.entry.org_verified_tier}
			seedId={it.entry.id}
			selected={it.entry.id === selectedId}
			stability={it.entry.stability}
		/>
	);

	// The community shelf is rendered in EVERY state below, including the empty and
	// error ones: the first-party feed failing or matching nothing is not a reason
	// to hide the listings that DID match — that was the practical cost of the old
	// separate tab, where a miss here meant the user never learned the community
	// feed had the thing.
	const communityShelf = (
		<CommunityShelf
			fallbackIcon={fallbackIcon}
			fetchNextPage={communityFetchNextPage}
			hasNextPage={communityHasNextPage}
			items={communityItems}
			loading={communityLoading}
			onSelect={onSelectCommunity}
			root={scrollEl}
			selectedId={communitySelectedId}
		/>
	);

	if (loading && items.length === 0) {
		return (
			<div className="flex flex-col gap-3" ref={setScrollEl}>
				<div className="flex items-center justify-center p-8 text-muted-foreground">
					<Spinner className="size-5" />
				</div>
				{communityShelf}
			</div>
		);
	}
	if (error && items.length === 0) {
		return (
			<div className="flex flex-col gap-3" ref={setScrollEl}>
				<div className="p-4 text-destructive text-sm">
					Couldn't load {nounPlural}: {error}
				</div>
				{communityShelf}
			</div>
		);
	}
	if (items.length === 0) {
		return (
			<div className="flex flex-col gap-3" ref={setScrollEl}>
				{communityItems.length === 0 ? (
					<Empty className="h-full p-6">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<HugeiconsIcon icon={fallbackIcon} />
							</EmptyMedia>
							<EmptyTitle>No {nounPlural} found</EmptyTitle>
							<EmptyDescription>Try a different search.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : null}
				{communityShelf}
			</div>
		);
	}

	// Shelve the grid by category, the way Home shelves by realm.
	//
	// Two cases deliberately stay FLAT, because a heading would be noise or a lie:
	//
	//  - A search is in progress. The user has already told us what they want; the
	//    answer is a relevance list, and chopping six results across four headed
	//    shelves makes it harder to read, not easier.
	//  - Everything landed on one shelf. A single heading above the whole grid says
	//    nothing that the tab title did not already say.
	//
	// Infinite scroll keeps working across shelves: `items` is the full accumulated
	// page set and is regrouped on every render, so a later page's items file into
	// the shelves that already exist instead of appending a second copy of them.
	const sections = searching
		? []
		: groupByCategory(items, (it) => it.entry.category);
	const shelved = sections.length > 1;

	return (
		<div ref={setScrollEl}>
			{shelved ? (
				<div className="flex flex-col gap-6">
					{sections.map((section) => (
						<section key={section.label}>
							<h3 className="mb-2 font-semibold text-base tracking-tight">
								{section.label}
							</h3>
							<StoreCardGrid>{section.items.map(card)}</StoreCardGrid>
						</section>
					))}
				</div>
			) : (
				<StoreCardGrid>{items.map(card)}</StoreCardGrid>
			)}
			<InfiniteSentinel
				hasMore={hasNextPage}
				loading={loadingMore}
				onLoadMore={fetchNextPage}
				root={scrollEl}
			/>
			{communityShelf}
		</div>
	);
}

/**
 * The trailing "From the community" shelf: third-party apps and plugins Ryu
 * discovered from the public GitHub topics, shown inside the Apps and Plugins
 * tabs instead of in a tab of their own.
 *
 * It renders NOTHING at all when the feed is empty — an always-present heading
 * over a blank grid would just be a permanent reminder of a section that has no
 * content, which is the failure mode a merged shelf is supposed to avoid.
 *
 * The trust notice is part of the shelf rather than the page, which is the whole
 * reason a merge is safe: an unreviewed listing can never appear beside a
 * first-party one without the disclosure travelling with it.
 */
function CommunityShelf({
	items,
	loading,
	selectedId,
	onSelect,
	fallbackIcon,
	hasNextPage,
	fetchNextPage,
	root,
}: {
	fallbackIcon: IconSvgElement;
	fetchNextPage: () => void;
	hasNextPage: boolean;
	items: AppCatalogItem[];
	loading: boolean;
	onSelect: (id: string) => void;
	root: HTMLElement | null;
	selectedId: string | null;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<section className="mt-6 flex flex-col gap-3 border-t pt-6">
			<div>
				<h3 className="font-semibold text-base tracking-tight">
					From the community
				</h3>
				<p className="text-muted-foreground text-xs">
					Discovered from public GitHub topics.
				</p>
			</div>
			<CommunityTrustNotice tone="banner" />
			<StoreCardGrid>
				{items.map((it) => (
					<StoreCatalogCard
						action={
							// Browse-only, deliberately: Core refuses a catalog install of an
							// unreviewed listing, so an Install button here could only ever
							// produce an error. `canInstall={false}` gives the row the same
							// "Details" affordance a descriptor-only listing gets, and the
							// preview carries the repository link to review it.
							<AppCardAction
								canInstall={false}
								item={it}
								onDisable={() => undefined}
								onInstall={() => onSelect(it.entry.id)}
								onOpen={() => onSelect(it.entry.id)}
								pending={false}
							/>
						}
						description={it.entry.description}
						dither={it.entry.icon_dither}
						icon={<HugeiconsIcon className="size-5" icon={fallbackIcon} />}
						iconBackground={it.entry.icon_background ?? undefined}
						iconId={it.entry.icon}
						iconUrl={it.entry.icon_url}
						key={it.entry.id}
						name={it.entry.name}
						onClick={() => onSelect(it.entry.id)}
						// The check rides on the COMMUNITY shelf too, and that is exactly
						// why publisher identity and listing review are kept as separate
						// axes rather than one "trusted" flag: these rows sit under a "Not
						// reviewed by Ryu" alert (nobody read the code) and a verified
						// publisher among them is still a verified publisher (we know who
						// to hold responsible). Wiring only the first-party grid would
						// leave the one case the split exists to express unmarked.
						orgVerified={it.entry.org_verified}
						orgVerifiedTier={it.entry.org_verified_tier}
						seedId={it.entry.id}
						selected={it.entry.id === selectedId}
						stability={it.entry.stability}
					/>
				))}
			</StoreCardGrid>
			<InfiniteSentinel
				hasMore={hasNextPage}
				loading={loading}
				onLoadMore={fetchNextPage}
				root={root}
			/>
		</section>
	);
}

/** True when this listing is required for Core and must never be offered a
 *  Disable/Uninstall control.
 *
 *  Gated on `source === "built-in"` as well as the flag. `mandatory` arrives on an
 *  entry that may have come from a remote catalog, and "you cannot turn this off"
 *  is precisely the claim a hostile listing would make about itself; Core only ever
 *  stamps it from its own constant, so a non-built-in entry carrying it is either
 *  lying or a source bug. Trusting it there would let a third-party listing render
 *  itself as un-removable — and the lifecycle would not back that up, so the user
 *  would be stuck looking at an app with no way to remove it and no explanation.
 *
 *  Exported for unit tests. */
export function isMandatoryListing(entry: CatalogEntry): boolean {
	return entry.mandatory === true && entry.source === "built-in";
}

/** Card action for an app: Install (inline), Enabled↔Disable morph (Disable
 *  inline), or Disabled→Enable which opens the preview so its grant dialog runs.
 *  Descriptor-only rows + read-only surfaces just open the preview. */
function AppCardAction({
	item,
	canInstall,
	pending,
	onInstall,
	onDisable,
	onOpen,
	onOpenSettings,
}: {
	item: AppCatalogItem;
	canInstall: boolean;
	pending: boolean;
	onInstall: () => void;
	onDisable: () => void;
	onOpen: () => void;
	/** Reveal this listing's settings tab; absent when it declares none. */
	onOpenSettings?: (() => void) | null;
}) {
	// A mandatory listing gets NO lifecycle control at all — not a disabled one.
	// Core refuses both disable and uninstall for it with a 403 and no force
	// override, so any button here could only ever produce an error toast. A greyed
	// button would still read as "there is something to do here"; the honest UI is a
	// static label saying why the controls are absent.
	if (isMandatoryListing(item.entry)) {
		// It still gets a Settings route, though: "cannot be removed" says nothing
		// about "cannot be configured", and a required app is often the one with the
		// most to configure. The overflow renders nothing when there is no settings
		// destination, so the badge stays alone in that case.
		return (
			<div className="flex shrink-0 items-center gap-1">
				<Badge className="text-xs" variant="secondary">
					Required
				</Badge>
				<StoreItemOverflowMenu onOpenSettings={onOpenSettings ?? undefined} />
			</div>
		);
	}
	if (item.entry.descriptor_only || !canInstall) {
		return (
			<div className="flex items-center gap-1.5">
				<PriceBadge entry={item.entry} />
				<StoreItemAction
					affordance={
						<Button onClick={onOpen} size="sm" variant="outline">
							Details
						</Button>
					}
					installed={false}
					onOpenSettings={onOpenSettings ?? undefined}
					reportTarget={reportTargetForApp(item)}
				/>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-1.5">
			{/* Price sits beside the action, not inside it: a paid listing the user
			    already owns still installs with the normal button, so the amount is
			    disclosure rather than a call to action. */}
			{item.installed ? null : <PriceBadge entry={item.entry} />}
			<StoreItemAction
				busy={pending}
				enabled={item.enabled}
				installed={item.installed}
				onDisable={onDisable}
				onEnable={onOpen}
				onInstall={onInstall}
				onOpenSettings={onOpenSettings ?? undefined}
				reportTarget={reportTargetForApp(item)}
			/>
		</div>
	);
}

/** The listing's price as a short label, or `null` when it is free.
 *
 *  Exported for unit tests. Free is represented by an ABSENT `pricing` (that is what
 *  the hosted catalog emits), so a zero amount is treated as free too rather than
 *  rendering "$0.00" — a price badge that says nothing costs attention for nothing. */
export function priceLabel(entry: CatalogEntry): string | null {
	const amount = entry.pricing?.amountMinor;
	if (typeof amount !== "number" || amount <= 0) {
		return null;
	}
	return formatPrice(amount, entry.pricing?.currency ?? "usd");
}

/** Paid-listing badge. Rendered on the card and in the detail header, because the
 *  unified first-party view interleaves the free git catalog with the hosted paid
 *  listings — without it the two are indistinguishable until checkout. */
function PriceBadge({ entry }: { entry: CatalogEntry }) {
	const label = priceLabel(entry);
	if (!label) {
		return null;
	}
	return (
		<Badge className="shrink-0 text-xs" variant="outline">
			{label}
		</Badge>
	);
}

function reportTargetForApp(item: AppCatalogItem) {
	const origin = item.entry.origin;
	const source =
		origin === "community"
			? ("github-community" as const)
			: item.entry.provenance === "github-topic" ||
					item.entry.source?.includes("github")
				? ("github-curated" as const)
				: ("mongo" as const);
	return {
		id: item.entry.id,
		kind: "plugin",
		itemName: item.entry.name,
		homepage: item.entry.repo_url ?? null,
		installSource: item.entry.source ?? item.entry.repo_url ?? null,
		source,
	};
}

/** The Install / Enable / Disable button cluster plus inline action error.
 *  Enable is gated behind a grant-confirmation dialog because enable is where
 *  the Gateway validates (and may deny) the app's declared grants. On a
 *  read-only surface (installLayer === null) this renders the host's affordance
 *  (Open in Ryu) instead of the lifecycle buttons. */
function AppActions({
	item,
	install,
	installing,
	setEnabled,
	lifecyclePending,
	error,
	installLayer,
	renderAffordance,
	onOpenSettings,
	status,
}: {
	item: AppCatalogItem;
	install: () => Promise<void>;
	installing: boolean;
	setEnabled: (enabled: boolean) => Promise<void>;
	lifecyclePending: boolean;
	error: string | null;
	installLayer: CatalogInstall | null;
	renderAffordance: CatalogHost["renderAffordance"];
	/** Reveal this listing's settings tab; absent when it declares none. */
	onOpenSettings?: (() => void) | null;
	/** Price / installed-state pills, pushed to the far end of the action bar.
	 *  They belong beside the verb they qualify ("Enable" — because it is already
	 *  Installed), not up in the hero where they competed with the app's name. */
	status?: ReactNode;
}) {
	const host = useCatalogHost();
	const node = host.useActiveNode();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { entry, grants, installed, enabled } = item;

	// Rejections are captured into the hook's `error` state (rendered below), so
	// these fire-and-forget handlers swallow them to avoid a floating promise.
	const noop = () => {
		// intentionally empty: error is surfaced via the hook
	};
	const runDisable = () => {
		setEnabled(false).catch(noop);
	};
	const runInstall = () => {
		install().catch(noop);
	};
	const confirmEnable = () => {
		setConfirmOpen(false);
		setEnabled(true).catch(noop);
	};

	let action: ReactNode;
	if (isMandatoryListing(entry)) {
		// Required for Core: no lifecycle buttons, and a sentence saying why rather
		// than a silently empty footer. Checked FIRST so it beats every branch below,
		// including the install/enable ones — a mandatory app is always already
		// installed and enabled, so any other branch could only offer a wrong verb.
		action = (
			<p className="text-muted-foreground text-sm">
				Part of Ryu. This app is required for the app to run and can't be
				disabled or removed.
			</p>
		);
	} else if (entry.descriptor_only) {
		// integrations.sh ships only a docs link, never a runnable config. For an
		// MCP directory entry we can still reach a real one-click install: hand off
		// to the in-app MCP catalog (backed by the official MCP registry),
		// pre-filtered by name, which resolves + installs the server. Desktop only
		// (an install layer + a navigate seam present); web keeps the docs link.
		if (entry.integration_kind === "mcp" && installLayer && host.navigate) {
			const openMcpCatalog = () =>
				host.navigate?.(`/store/mcp/q/${encodeURIComponent(entry.name)}`);
			action = (
				<Button onClick={openMcpCatalog} size="sm">
					<HugeiconsIcon className="size-4" icon={Download01Icon} />
					Find in MCP catalog
				</Button>
			);
		} else if (entry.integration_kind === "openapi" && installLayer) {
			// A REST API directory entry: import its OpenAPI spec as gateway-governed
			// `http` tools (resolved server-side via apis.guru from the entry id).
			action = (
				<ImportToolsAction
					body={{ id: entry.id }}
					endpoint="/api/tools/import/openapi"
					node={node}
				/>
			);
		} else if (
			entry.integration_kind === "graphql" &&
			installLayer &&
			entry.integration_url
		) {
			// A GraphQL endpoint: import it as a single gateway-governed query tool.
			action = (
				<ImportToolsAction
					body={{ name: entry.name, url: entry.integration_url }}
					endpoint="/api/tools/import/graphql"
					node={node}
				/>
			);
		} else {
			const href = safeHttpUrl(entry.integration_url);
			action = href ? (
				<Button
					render={<a href={href} rel="noopener noreferrer" target="_blank" />}
					size="sm"
					variant="outline"
				>
					<HugeiconsIcon className="size-4" icon={Link01Icon} />
					View setup docs
				</Button>
			) : (
				<p className="text-muted-foreground text-sm">
					Browse-only descriptor — no install URL on file.
				</p>
			);
		}
	} else if (!installLayer) {
		// Read-only surface: no local install; deep-link into the Ryu app instead.
		action =
			renderAffordance?.({
				id: entry.id,
				name: entry.name,
				realm: "app",
			}) ?? null;
	} else if (!installed) {
		const InstallButton = installLayer.InstallButton;
		action = (
			<InstallButton
				idleVariant="ghost"
				installing={installing}
				onClick={runInstall}
				progress={{ kinds: ["tool", "other"], name: entry.name }}
			>
				<HugeiconsIcon className="size-4" icon={Download01Icon} />
				Install
			</InstallButton>
		);
	} else if (enabled) {
		action = (
			<Button
				disabled={lifecyclePending}
				onClick={runDisable}
				size="sm"
				variant="outline"
			>
				{lifecyclePending ? <Spinner className="size-4" /> : null}
				Disable
			</Button>
		);
	} else {
		action = (
			<Button
				disabled={lifecyclePending}
				onClick={() => setConfirmOpen(true)}
				size="sm"
			>
				{lifecyclePending ? <Spinner className="size-4" /> : null}
				Enable
			</Button>
		);
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-wrap items-center gap-2">
				{action}
				{/* Beside the lifecycle verb, not inside it: configuring an app is not
				    part of installing or disabling it, and this is where a user who
				    just clicked into the listing looks for its API key. */}
				{onOpenSettings ? (
					<Button onClick={onOpenSettings} size="sm" variant="outline">
						<HugeiconsIcon className="size-4" icon={Settings01Icon} />
						Settings
					</Button>
				) : null}
				{status ? (
					<span className="ml-auto flex shrink-0 items-center gap-2">
						{status}
					</span>
				) : null}
			</div>
			{error && <p className="text-destructive text-sm">{error}</p>}

			{/* Enable confirmation: list grants before enabling. Install-only. */}
			{installLayer ? (
				<AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Enable {entry.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								{grants.length === 0
									? "This plugin requests no special permissions."
									: "Enabling grants this plugin the following permissions. They are validated by the Gateway."}
							</AlertDialogDescription>
						</AlertDialogHeader>
						{grants.length > 0 && <GrantList grants={grants} />}
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction onClick={confirmEnable}>
								Allow
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			) : null}
		</div>
	);
}

/** A list of permission grants in plain English (label + one-line description),
 *  so a non-technical user understands what they're approving. */
function GrantList({ grants }: { grants: string[] }) {
	return (
		<ul className="flex flex-col gap-1.5">
			{grants.map((g) => {
				const description = grantDescription(g);
				return (
					<li className="rounded-md border px-3 py-1.5" key={g}>
						<div className="font-medium text-sm">{grantLabel(g)}</div>
						{description ? (
							<div className="text-muted-foreground text-xs">{description}</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

/** The detail panel's tab set. Overview, Reviews and Health are ALWAYS present
 *  (see the `tabs` array below); the content tabs are conditional on the listing
 *  actually carrying that content. */
type DetailTabId =
	| "overview"
	| "readme"
	| "api"
	| "versions"
	| "dependencies"
	| "reviews"
	| "health";

function AppDetailPanel({
	selectedId,
	item,
	detail,
	detailLoading,
	detailError,
	install,
	installing,
	setEnabled,
	lifecyclePending,
	error,
	installLayer,
	noun,
	renderAffordance,
	settingsOpener,
}: {
	selectedId: string | null;
	item: AppCatalogItem | null;
	detail: PluginCatalogDetail | null;
	detailLoading: boolean;
	detailError: string | null;
	install: () => Promise<void>;
	installing: boolean;
	setEnabled: (enabled: boolean) => Promise<void>;
	lifecyclePending: boolean;
	error: string | null;
	installLayer: CatalogInstall | null;
	noun: string;
	renderAffordance: CatalogHost["renderAffordance"];
	/** Resolves this listing to its "open settings" action (see the host seam). */
	settingsOpener: PluginSettingsOpener;
}) {
	const { Markdown, fetchVersionDetail: hostFetchVersionDetail } =
		useCatalogHost();
	// Reviews live on the control plane, reached through the money-layer host. Read
	// optionally: a surface that mounts the catalog without the money layer (test
	// harnesses, the storyboard) simply gets no Reviews tab.
	//
	// Community listings are excluded even when the service IS present: they were
	// discovered from a GitHub topic and have no record on the control plane, so a
	// review could never be stored against one. The tab would be permanently empty
	// and any attempt to post would fail with "item not found" — an affordance that
	// cannot work should not be offered.
	const reviewsHost = useMarketplaceHostOptional()?.reviews ?? null;
	const reviewsService = item && isCommunityEntry(item) ? null : reviewsHost;
	const [tab, setTab] = useState<DetailTabId>("overview");
	// Reset to Overview when the selection changes, so opening a second listing
	// never lands on a tab that listing does not have.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetting is keyed
	// on the selection changing, not on the setter.
	useEffect(() => setTab("overview"), [selectedId]);

	// The scan needs the DETAIL payload, not just the card: half its checks read
	// fields only the detail fetch carries (README, licence, timestamps, declared
	// permissions). Grading a card alone would score every listing on a read-only
	// surface as "undocumented, unlicensed" — technically true of the card, and
	// completely misleading about the listing. So no detail ⇒ no grade shown.
	// Memoized so scrolling the panel does not re-run every check per frame.
	const scorecard = useMemo(
		() => (detail ? runScorecard(item?.entry ?? null, detail) : null),
		[item?.entry, detail]
	);

	if (!(selectedId && item)) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={GridIcon} />
					</EmptyMedia>
					<EmptyTitle>No {noun} selected</EmptyTitle>
					<EmptyDescription>
						Pick a {noun} on the left to read what it does, review its
						permissions, and install it.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const { entry, grants, installed, enabled } = item;
	// The repo a version tag can be read from. `repositoryUrl` is the detail's
	// own field; `repo_url` is the card's — either names the same GitHub repo.
	const versionRepo = detail?.repositoryUrl ?? entry.repo_url ?? null;
	const integrationUrl =
		entry.integration_url ?? detail?.url ?? detail?.descriptor?.url ?? null;
	// The hero band always renders — it is the listing's header. This gates only
	// whether it paints the listing's ART: a descriptor-only entry's `banner` /
	// `icon_dither` describe the UPSTREAM service, so using them would present a
	// third-party brand as this listing's own. Those fall back to the muted band.
	//
	// It used to gate the whole hero, which is why a listing with no presentation
	// metadata opened on a bare heading in mid-air with no header at all.
	const showHero = !entry.descriptor_only;
	// An integrations.sh reference entry is descriptor-only AND carries an
	// integration kind. A community GitHub listing is also descriptor-only but has
	// no integration kind — it is a real plugin with a real manifest, so it gets
	// the full tab set rather than the integration blurb.
	const isIntegrationDescriptor = Boolean(
		entry.descriptor_only && entry.integration_kind
	);

	// The Overview tab is now PROSE + what-you-get. Everything reference-shaped
	// (Information, external links) moved to the shell's right rail, and the meta
	// facts moved to the stat strip — the two things that make a wide dialog read
	// as an app-store listing rather than one tall column with air beside it.
	const overview = (
		<div className="flex flex-col gap-6">
			{entry.description ? (
				<ListingSection icon={InformationCircleIcon} title="About">
					<p className="text-muted-foreground text-sm leading-relaxed">
						{entry.description}
					</p>
				</ListingSection>
			) : null}

			{isIntegrationDescriptor ? (
				<DescriptorDetail
					detail={detail}
					detailError={detailError}
					detailLoading={detailLoading}
					integrationUrl={integrationUrl}
				/>
			) : (
				<>
					<AppIncludedSection
						runnables={detail?.runnables ?? entry.runnables}
					/>

					<ListingSection icon={SquareLock01Icon} title="Permissions">
						{grants.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								This plugin requests no special permissions.
							</p>
						) : (
							<GrantList grants={grants} />
						)}
					</ListingSection>
				</>
			)}
		</div>
	);

	// Hero chips: the identity facts (Built-in / Community / Required / kinds).
	// Free-form `tags` stay OUT of the hero — a listing with nine of them turned
	// the header into a tag cloud — and live in the rail instead.
	const heroBadges = [
		entry.built_in ? "Built-in" : null,
		isCommunityEntry(item) ? "Community" : null,
		stabilityLabel(entry.stability),
		isMandatoryListing(entry) ? "Required" : null,
		...entry.kinds.map((k) => k.toUpperCase()),
	].filter((b): b is string => Boolean(b));

	return (
		<ListingDetailShell
			actions={
				<AppActions
					error={error}
					install={install}
					installing={installing}
					installLayer={installLayer}
					item={item}
					lifecyclePending={lifecyclePending}
					onOpenSettings={settingsOpener(entry.id)}
					renderAffordance={renderAffordance}
					setEnabled={setEnabled}
					status={
						<>
							<PriceBadge entry={entry} />
							{entry.descriptor_only ? (
								<Badge variant="outline">
									{entry.integration_kind?.toUpperCase() ?? "Descriptor"}
								</Badge>
							) : (
								<AppStatusBadge enabled={enabled} installed={installed} />
							)}
						</>
					}
				/>
			}
			aside={
				<AppDetailAside
					detail={detail}
					entry={entry}
					onOpenHealth={() => setTab("health")}
					scorecard={scorecard}
				/>
			}
			gallery={
				<ListingGalleryRail
					name={entry.name}
					screenshots={detail?.screenshots}
				/>
			}
			hero={
				<AppHero
					badges={heroBadges}
					detail={detail}
					entry={entry}
					showArt={showHero}
				/>
			}
			notice={
				/* Load-bearing placement: unavoidable in the reading path BEFORE the
				   action bar, so it cannot be scrolled past on the way to Install. */
				isCommunityEntry(item) ? (
					<CommunityTrustNotice
						tone="inline"
						topic={detail?.discoveredFrom?.topic}
					/>
				) : null
			}
			stats={
				<ListingStatStrip
					items={appStatItems({
						detail,
						entry,
						onOpenHealth: () => setTab("health"),
						onOpenReviews: () => setTab("reviews"),
						scorecard,
						showRating: Boolean(reviewsService),
					})}
				/>
			}
		>
			{detailLoading && !isIntegrationDescriptor ? (
				<Spinner className="size-4" />
			) : null}
			{detailError && !isIntegrationDescriptor ? (
				<p className="text-destructive text-sm">{detailError}</p>
			) : null}

			<ListingDetailTabs
				activeTab={tab}
				detail={detail}
				entry={entry}
				fetchVersionDetail={
					// Offered only when the host can serve it AND the listing names a repo —
					// without one there is no tag to read from.
					hostFetchVersionDetail && versionRepo
						? (tag: string) => hostFetchVersionDetail(versionRepo, tag)
						: undefined
				}
				Markdown={Markdown}
				onTabChange={setTab}
				overview={overview}
				reviewsService={reviewsService}
				scorecard={scorecard}
			/>
		</ListingDetailShell>
	);
}

/** The stat strip's cells for an app/plugin listing. Built as data rather than
 *  markup so the same facts can be reordered per realm without each realm
 *  re-deriving them — and so an absent fact drops its whole cell rather than
 *  rendering an empty one, which is what makes the strip read as evenly divided
 *  at any listing's level of completeness. */
function appStatItems({
	detail,
	entry,
	onOpenHealth,
	onOpenReviews,
	scorecard,
	showRating,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
	onOpenHealth: () => void;
	onOpenReviews: () => void;
	scorecard: Scorecard | null;
	showRating: boolean;
}): ListingStat[] {
	// Annotated as `(ListingStat | null)[]` so an absent fact contributes `null`
	// rather than widening the array's inferred element union per branch.
	const ratingCount = entry.rating_count ?? 0;
	const version = detail?.version ?? entry.version ?? null;
	const updated = formatDate(detail?.updatedAt);
	const downloads = detail?.downloads ?? null;
	const surfaces = detail?.surfaces ?? entry.surfaces ?? [];
	const developer = detail?.developer ?? entry.developer ?? null;
	const category = detail?.category ?? entry.category ?? null;

	const cells: (ListingStat | null)[] = [
		showRating && ratingCount > 0
			? {
					label: `${formatCount(ratingCount)} Ratings`,
					// Apple's shape exactly: the number is the headline, the stars are
					// the caption. Clicking the cell opens the tab that loads them.
					onClick: onOpenReviews,
					sub: (
						<StarRating
							className="justify-center"
							size="size-3"
							value={entry.rating_average ?? 0}
						/>
					),
					value: (entry.rating_average ?? 0).toFixed(1),
				}
			: null,
		scorecard?.grade && scorecard.score !== null
			? {
					label: "Health",
					onClick: onOpenHealth,
					sub: `${scorecard.score}/100`,
					value: scorecard.grade,
				}
			: null,
		version && !entry.descriptor_only
			? { label: "Version", value: `v${version.replace(/^v/, "")}` }
			: null,
		category ? { label: "Category", sub: "Category", value: category } : null,
		developer ? { label: "Developer", value: developer } : null,
		updated ? { label: "Updated", value: updated } : null,
		typeof downloads === "number"
			? { label: "Downloads", value: formatCount(downloads) }
			: null,
		surfaces.length > 0
			? {
					label: "Runs on",
					value: surfaces.map((s) => surfaceLabel(s)).join(", "),
				}
			: null,
	];
	return cells.filter((item): item is ListingStat => item !== null);
}

/** The detail shell's right rail for an app/plugin: Information, then the
 *  listing's free-form tags. This is the material that used to sit at the BOTTOM
 *  of the Overview tab, below permissions — i.e. below the fold on every listing —
 *  where "who made this, what licence, where's the privacy policy" is exactly what
 *  a store visitor is scanning for before they install. */
function AppDetailAside({
	detail,
	entry,
	onOpenHealth,
	scorecard,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
	onOpenHealth: () => void;
	scorecard: Scorecard | null;
}) {
	const hasTags = entry.tags.length > 0;
	// Guarded on the DATA, not on whether the child rendered: the shell reserves a
	// whole 18rem column for a truthy `aside`, and a fragment of three nulls is
	// truthy — that is a wide empty gutter on every listing with no metadata.
	const hasInfo = appInfoRows({ detail, entry }).length > 0;
	if (!(hasInfo || hasTags || scorecard)) {
		return null;
	}
	return (
		<>
			<AppInformationSection detail={detail} entry={entry} />
			{scorecard ? (
				<ListingAsideCard title="Trust">
					<ScorecardBadge onClick={onOpenHealth} scorecard={scorecard} />
				</ListingAsideCard>
			) : null}
			{hasTags ? (
				<ListingAsideCard title="Tags">
					<div className="flex flex-wrap gap-1">
						{entry.tags.map((t) => (
							<Badge className="font-normal text-xs" key={t} variant="outline">
								{t}
							</Badge>
						))}
					</div>
				</ListingAsideCard>
			) : null}
		</>
	);
}

/** Presentational icon per bundled-runnable kind. Falls back to a package glyph
 *  for unknown kinds so an unrecognized runnable still renders a row. */
const RUNNABLE_KIND_ICONS: Record<string, typeof PackageIcon> = {
	agent: Robot01Icon,
	companion: LayoutGridIcon,
	mcp: ServerStack01Icon,
	skill: BookOpen01Icon,
	tool: Wrench01Icon,
	workflow: WorkflowSquare01Icon,
};

/** Short human label per runnable kind (falls back to a capitalized kind). */
const RUNNABLE_KIND_LABELS: Record<string, string> = {
	agent: "Agent",
	companion: "Companion",
	mcp: "MCP",
	skill: "Skill",
	tool: "Tool",
	workflow: "Workflow",
};

function runnableKindIcon(kind: string): typeof PackageIcon {
	return RUNNABLE_KIND_ICONS[kind] ?? PackageIcon;
}

/** Exported for unit tests — see the note on {@link isCompanionApp}. */
export function runnableKindLabel(kind: string): string {
	return (
		RUNNABLE_KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
	);
}

/** "What's included": a read-only list of the bundled runnables a full app ships
 *  (desktop-only — `detail.runnables` is absent on the web read-only host, so the
 *  section renders nothing there). Informational rows, not functional toggles. */
function AppIncludedSection({
	runnables,
}: {
	runnables?: PluginCatalogDetail["runnables"];
}) {
	if (!runnables || runnables.length === 0) {
		return null;
	}
	return (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-center gap-1.5 font-medium text-sm">
				<HugeiconsIcon
					className="size-4 text-muted-foreground"
					icon={PackageIcon}
				/>
				What&apos;s included
			</h3>
			<ul className="flex flex-col gap-1.5">
				{runnables.map((runnable) => (
					<li
						className="flex items-center gap-2.5 rounded-md border px-3 py-2"
						key={runnable.id}
					>
						<HugeiconsIcon
							className="size-4 shrink-0 text-muted-foreground"
							icon={runnableKindIcon(runnable.kind)}
						/>
						<span className="min-w-0 flex-1 truncate text-sm">
							{runnable.name ?? runnable.id}
						</span>
						<Badge className="shrink-0 text-xs" variant="secondary">
							{runnableKindLabel(runnable.kind)}
						</Badge>
					</li>
				))}
			</ul>
		</section>
	);
}

/** Re-exported from `./plugin-id.ts` (shared with the detail tabs) because it is
 *  part of this module's tested surface — see the note on {@link isCompanionApp}. */
export { prettyPluginId } from "./plugin-id.ts";

/** The render-layer href guard now lives in `./safe-url.ts` so the detail panels
 *  share one copy. Re-exported here because it is part of this module's tested
 *  surface — see the note on {@link isCompanionApp}. */
export { safeHttpUrl } from "./safe-url.ts";

/** One value cell in the Information table. Renders as a safe external link only
 *  when `href` is a valid http(s) URL; otherwise plain text. The label half is the
 *  shell's ({@link ListingInfoGrid}) — this is only the value, so every realm's
 *  rail lays its rows out identically. */
function InfoValue({ href, value }: { href?: string | null; value: string }) {
	const safeHref = safeHttpUrl(href);
	if (!safeHref) {
		return <span className="truncate">{value}</span>;
	}
	return (
		<a
			className="truncate hover:underline"
			href={safeHref}
			rel="noopener noreferrer"
			target="_blank"
		>
			{value}
		</a>
	);
}

/** The Information rows for a listing, as data. Rows come from `detail` (desktop)
 *  falling back to `entry` (present on every surface), so on the web host — where
 *  `detail` is null — it still shows Developer/Category/Version from the entry and
 *  simply omits the detail-only rows (homepage/license/privacy/terms). */
function appInfoRows({
	detail,
	entry,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
}): { href?: string | null; label: string; value: string }[] {
	const version = entry.descriptor_only ? null : (entry.version ?? null);
	return [
		{ label: "Developer", value: detail?.developer ?? entry.developer ?? null },
		{ label: "Category", value: detail?.category ?? entry.category ?? null },
		{ label: "Version", value: version },
		{ label: "License", value: detail?.license ?? null },
		{
			href: detail?.website ?? null,
			label: "Website",
			value: detail?.website ?? null,
		},
		{
			href: detail?.privacyPolicyUrl ?? null,
			label: "Privacy Policy",
			value: detail?.privacyPolicyUrl ?? null,
		},
		{
			href: detail?.termsOfServiceUrl ?? null,
			label: "Terms of Service",
			value: detail?.termsOfServiceUrl ?? null,
		},
	].filter(
		(row): row is { href?: string | null; label: string; value: string } =>
			Boolean(row.value)
	);
}

/** "Information": the key/value table. Lives in the detail shell's RIGHT RAIL
 *  now rather than at the bottom of the Overview tab — "who made this, what
 *  licence, where is the privacy policy" is what a store visitor scans for before
 *  installing, and below permissions on a tall single column it was below the fold
 *  on every listing. */
function AppInformationSection({
	detail,
	entry,
}: {
	detail: PluginCatalogDetail | null;
	entry: CatalogEntry;
}) {
	const rows = appInfoRows({ detail, entry });
	if (rows.length === 0) {
		return null;
	}
	return (
		<ListingAsideCard title="Information">
			<ListingInfoGrid
				rows={rows.map((row) => ({
					label: row.label,
					value: <InfoValue href={row.href} value={row.value} />,
				}))}
			/>
		</ListingAsideCard>
	);
}

/** The app detail hero. Thin wrapper over the shared {@link ListingHero}: this
 *  resolves the listing's ART (which is realm-specific — `icon`/`icon_url`/svgl
 *  brand marks) and the shell owns the LAYOUT (band height, scrim, icon tile,
 *  title stack, badge chips), so an app hero and an MCP hero cannot drift.
 *
 *  Always rendered, even for a listing with no presentation metadata: the band
 *  falls back to the muted surface, which is a header. It used to be omitted, and
 *  a listing without art opened with no header at all — the dialog started at a
 *  bare `<h2>` mid-air. */
function AppHero({
	badges,
	detail,
	entry,
	showArt,
	tagline,
}: {
	badges: string[];
	/** The loaded detail payload, when there is one. Only its verification fields
	 *  are read here: the detail is the fuller, fresher record, so it wins over the
	 *  card's copy the same way the health scorecard resolves `reviewed`. */
	detail?: PluginCatalogDetail | null;
	entry: CatalogEntry;
	/** Resolved by the caller so the detail payload's tagline can win when the
	 *  card carries none. */
	tagline?: string | null;
	/** False for descriptor-only listings, whose `icon_*` fields describe the
	 *  UPSTREAM service rather than a Ryu package — painting them as a hero would
	 *  present a third-party brand as the listing's own art. */
	showArt: boolean;
}) {
	const svglIndex = useSvglIndex();
	// Raster logo for the hero: `icon_url` (any https host), an `svgl:` brand mark,
	// or a GitHub-image URL pasted into the `icon` field (the card's
	// {@link resolveCardIcon} rule, so hero and card never disagree).
	const {
		iconId: previewIconId,
		iconUrl: previewIconUrl,
		iconUrlDark: previewIconUrlDark,
		brand: isBrandMark,
	} = resolveCardIcon({
		icon: entry.icon,
		iconUrl: entry.icon_url,
		svglIndex,
	});
	// ORG verification (who published this — NOT the manifest-signature axis the web
	// marketplace calls `verified`) is read off ONE source, never mixed. The detail
	// payload is the fresher record so it wins whole once it carries the flag —
	// including a `false`, which is how a revoked check reaches an already-rendered
	// card. Pairing the detail's flag with the card's tier would let a stale
	// qualifier survive a re-tiering the newer record already reflects. An absent
	// flag (older control plane, or an enrichment failure — see `enrichmentError`)
	// falls back to the card wholesale, the same precedence the health scorecard
	// uses for `reviewed`.
	const detailKnowsOrgVerification = detail?.orgVerified !== undefined;
	const orgVerified = detailKnowsOrgVerification
		? detail?.orgVerified
		: entry.org_verified;
	const orgVerifiedTier = detailKnowsOrgVerification
		? detail?.orgVerifiedTier
		: entry.org_verified_tier;
	return (
		<ListingHero
			badges={badges}
			banner={showArt ? entry.banner : null}
			dither={showArt ? entry.icon_dither : null}
			fallback={entry.accent_color ?? null}
			icon={
				previewIconUrl ? (
					<BrandOrCoverImage
						brand={isBrandMark === true}
						dark={previewIconUrlDark ?? null}
						light={previewIconUrl}
					/>
				) : previewIconId ? (
					<Icon icon={previewIconId} size={34} />
				) : (
					<HugeiconsIcon className="size-8" icon={GridIcon} />
				)
			}
			iconBackground={entry.icon_background ?? null}
			name={entry.name}
			nameBadge={
				// `tone="hero"` because every foreground in this band is fixed white over
				// an author-supplied wash under a black scrim — the card's themed
				// blue-on-tint chip would be unreadable here.
				<VerifiedBadge
					orgVerified={orgVerified}
					tier={orgVerifiedTier}
					tone="hero"
				/>
			}
			tagline={tagline}
		/>
	);
}

function DescriptorDetail({
	detail,
	detailLoading,
	detailError,
	integrationUrl,
}: {
	detail: PluginCatalogDetail | null;
	detailLoading: boolean;
	detailError: string | null;
	integrationUrl: string | null;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="font-medium text-sm">Integration details</h3>
			{detailLoading ? <Spinner className="size-4" /> : null}
			{detailError ? (
				<p className="text-destructive text-sm">{detailError}</p>
			) : null}
			{integrationUrl ? (
				<p className="break-all font-mono text-muted-foreground text-xs">
					{integrationUrl}
				</p>
			) : null}
			{detail?.domain ? (
				<p className="text-muted-foreground text-sm">
					Domain: <span className="text-foreground">{detail.domain}</span>
				</p>
			) : null}
			{detail?.feeds && detail.feeds.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{detail.feeds.map((feed) => (
						<Badge className="text-xs" key={feed} variant="outline">
							{feed}
						</Badge>
					))}
				</div>
			) : null}
			<p className="text-muted-foreground text-sm">
				Descriptors are reference entries from integrations.sh — open the link
				to configure MCP, OpenAPI, or other surfaces in your agent stack.
			</p>
		</section>
	);
}

/** Status pill in the detail header: Enabled > Installed > nothing. */
function AppStatusBadge({
	enabled,
	installed,
}: {
	enabled: boolean;
	installed: boolean;
}) {
	if (enabled) {
		return (
			<Badge className="shrink-0 gap-1" variant="secondary">
				<HugeiconsIcon
					className="size-3.5 text-success"
					icon={CheckmarkCircle02Icon}
				/>
				Enabled
			</Badge>
		);
	}
	if (installed) {
		return (
			<Badge className="shrink-0" variant="outline">
				Installed
			</Badge>
		);
	}
	return null;
}
