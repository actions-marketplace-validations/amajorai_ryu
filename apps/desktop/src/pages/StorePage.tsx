import {
	CpuIcon,
	Download01Icon,
	GridIcon,
	Home01Icon,
	Link01Icon,
	SlidersHorizontalIcon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
	StoreComingSoon,
	StoreGlobalSearch,
	type StoreSectionTab,
	StoreSectionTabs,
} from "@ryu/blocks/desktop/store";
import { InstalledOnlyProvider } from "@ryu/marketplace/catalog/installed-filter";
import { REALM_ICONS } from "@ryu/marketplace/catalog/realm-icons";
import { Button } from "@ryu/ui/components/button";
import { Logo } from "@ryu/ui/components/logo";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@ryu/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { cn } from "@ryu/ui/lib/utils";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { DesktopMarketplaceHost } from "@/src/components/marketplace/host.tsx";
import AccountSection from "@/src/components/store/AccountSection.tsx";
import AgentsCatalogSection from "@/src/components/store/AgentsCatalogSection.tsx";
import AppsCatalogSection from "@/src/components/store/AppsCatalogSection.tsx";
import ContributedStoreSection from "@/src/components/store/ContributedStoreSection.tsx";
import { DesktopCatalogHost } from "@/src/components/store/catalog-host.tsx";
import EnginesCatalogSection from "@/src/components/store/EnginesCatalogSection.tsx";
import IntegrationsCatalogSection from "@/src/components/store/IntegrationsCatalogSection.tsx";
import McpCatalogSection from "@/src/components/store/McpCatalogSection.tsx";
import ModelsCatalogSection from "@/src/components/store/ModelsCatalogSection.tsx";
import SkillsCatalogSection from "@/src/components/store/SkillsCatalogSection.tsx";
import StoreHome from "@/src/components/store/StoreHome.tsx";
import StoreSearchResults from "@/src/components/store/StoreSearchResults.tsx";
import {
	type StoreToolbarConfig,
	StoreToolbarProvider,
} from "@/src/components/store/storeToolbar.tsx";
import {
	contributedTabForSection,
	resolveStoreSection,
	STORE_GROUP_ORDER,
	storeTabGroup,
	storeTabSectionValue,
	useContributedStoreTabs,
} from "@/src/hooks/useContributedStoreTabs.ts";
import { useStorePrefetch } from "@/src/hooks/useStorePrefetch.ts";
import {
	type StoreSearchRealm,
	useStoreSearch,
} from "@/src/hooks/useStoreSearch.ts";
import type { PluginStoreTab } from "@/src/lib/api/plugins.ts";

/** The sections the shell itself owns. Everything else in the bar is an
 *  app-registered `contributes.store_tabs[]` entry — see
 *  {@link useContributedStoreTabs}. */
type BuiltinStoreSection =
	| "home"
	| "integrations"
	| "apps"
	| "plugins"
	| "models"
	| "skills"
	| "mcp"
	| "agents"
	| "engines"
	| "account";

/** An active section value: a {@link BuiltinStoreSection}, or a contributed tab's
 *  `plugin:<pluginId>:<tabId>` key. Deliberately open — the Store's section list is
 *  no longer a closed union the shell can enumerate at compile time. */
type StoreSection = string;

const SECTIONS: {
	value: BuiltinStoreSection;
	label: string;
	icon: IconSvgElement;
	/** Optional rendered mark shown instead of `icon` — see StoreSectionTab. */
	iconNode?: ReactNode;
	group: string;
}[] = [
	// Home: the app-store landing — featured rail + a row per realm, so
	// "everything" has one front door before the per-realm sections. The
	// store-wide search lives in the nav rail, above the section list.
	{ value: "home", label: "Home", icon: Home01Icon, group: "discover" },
	// Integrations: the brand-first front door — one card per service (Notion,
	// Slack, …) merged from the integrations.sh directory and Composio's toolkit
	// catalog. Opening a brand surfaces every related Skill/MCP/Plugin in one
	// place. Sits first in the browse cluster, so the group divider falls between
	// Home and it — one separator, then Integrations atop the per-realm catalogs.
	{
		value: "integrations",
		label: "Integrations",
		icon: Link01Icon,
		group: "catalog",
	},
	// Browse — the per-realm catalogs (Core catalogs + inline paid Marketplace
	// items). Apps = plugins that ship a Companion UI surface; Plugins = the
	// rest (tools/agents/channels/policies + integration descriptors).
	{ value: "apps", label: "Apps", icon: REALM_ICONS.apps, group: "catalog" },
	{
		value: "plugins",
		label: "Plugins",
		icon: REALM_ICONS.plugins,
		group: "catalog",
	},
	{
		value: "models",
		label: "Models",
		icon: REALM_ICONS.models,
		group: "catalog",
	},
	{
		value: "skills",
		label: "Skills",
		icon: REALM_ICONS.skills,
		group: "catalog",
	},
	// MCP servers from the official registry (and registries behind the seam).
	{ value: "mcp", label: "MCP", icon: REALM_ICONS.mcp, group: "catalog" },
	// Agents wears the Ryu mark itself, not a glyph: an agent IS a Ryu employee
	// (the catalog's cards are its employee badges), and the target glyph every
	// other realm-style icon sat beside said nothing about that. `icon` stays as
	// the path fallback for any surface that can only render an IconSvgElement.
	{
		value: "agents",
		label: "Agents",
		icon: REALM_ICONS.agents,
		iconNode: <Logo size="16px" variant="outline" />,
		group: "catalog",
	},
	// Workflow Templates used to sit here as a hardcoded row. It is now registered by
	// the Workflows app itself (`apps-store/workflows/manifest.json` →
	// `contributes.store_tabs`) and arrives through `useContributedStoreTabs`, in the
	// same `catalog` group — the first tab to go through the bridge that lets any app
	// own a marketplace section.
	// Engines = all local inference runtimes, grouped inside by modality
	// (Text · Image · Speech · Embeddings). Voice lives here now, not its own tab.
	{ value: "engines", label: "Engines", icon: CpuIcon, group: "catalog" },
	// Community listings — the third-party apps + plugins discovered from the public
	// GitHub topics `ryu-app` / `ryu-plugin` — have NO tab of their own. Provenance
	// is not a category: a community web-scraper plugin answers the same question as
	// a first-party one, and a separate tab meant a user who searched Plugins and
	// found nothing never learned the community feed had it. They now render as a
	// trailing, separately-headed shelf inside Apps and Plugins, carrying the same
	// "not reviewed by Ryu" notice they carried here (see `CommunityShelf`).
	//
	// "Added" is NOT a tab either, for the same reason and by the same fix: it was a
	// thirteenth pill that was not a category, and reaching an installed model
	// through it meant leaving the Models tab and every affordance that makes Models
	// usable. It is the chrome's "Installed only" switch now
	// ({@link InstalledOnlyProvider}), which narrows whichever section you are
	// already on. Tools is deliberately not here either: the MCP servers registered
	// on this node live in the Library (`/tools`); browse the catalog under "MCP".
	//
	// Cross-node health + per-node sidecar controls live in the node selector.
	// Account — Marketplace money layer: licenses, selling, connections.
	{ value: "account", label: "Account", icon: Wallet01Icon, group: "account" },
];

const BUILTIN_SECTION_VALUES = SECTIONS.map((s) => s.value);

function isBuiltinSection(value: string): value is BuiltinStoreSection {
	return (BUILTIN_SECTION_VALUES as string[]).includes(value);
}

/**
 * Unified Store shell, App Store-shaped: one inline page chrome — the section
 * title, the section tabs, and the store-wide search — over the active section's
 * content.
 *
 * The chrome used to be a floating, translucent bar pinned to the bottom of the
 * pane with the tabs, the search and the filter panel all folded inside it. It is
 * ordinary page furniture now: the tabs scroll in the flow (the list is
 * open-ended — every app may register one), search is a button beside them, and a
 * section's own filters live with that section's content
 * ({@link StoreToolbarProvider} → the toolbar row here).
 *
 * The section is decided once on mount from `initialSection` (driven by the tab
 * path in Layout) and switched in-place from the tabs. Typing in the store-wide
 * search shows aggregated cross-realm results in place of the section; picking a
 * result opens that realm with the query carried over.
 */
export default function StorePage({
	initialSection = "home",
	initialQuery,
	initialInstalledOnly = false,
}: {
	initialSection?: string;
	/** Open with the "Installed only" switch already on. Set by the legacy
	 *  `/apps`, `/extensions` and `/fleet` routes, which used to open the retired
	 *  "Added" section — the switch is where that view lives now. */
	initialInstalledOnly?: boolean;
	/** Seed the active section's search (deep-links carry it, e.g. the
	 *  integrations.sh → MCP-catalog hand-off pre-filters by server name). */
	initialQuery?: string;
}) {
	// App-registered sections. These arrive asynchronously (Core's contributions
	// endpoint), so `initialSection` is resolved against them in an effect below
	// rather than once at mount — a deep link to `/store/workflows` must land on the
	// Workflows tab even though the contribution has not loaded on first render.
	const contributedTabs = useContributedStoreTabs();
	// Warm every tab's opening view in the background, so switching tabs reads
	// from cache instead of spinning once per tab per session.
	useStorePrefetch();
	const [section, setSection] = useState<StoreSection>(() =>
		isBuiltinSection(initialSection) ? initialSection : "home"
	);
	// The requested section, held until it can be resolved. Cleared once honoured so
	// a later manual pick is never overridden by a stale deep link.
	const [pendingSection, setPendingSection] = useState<string | null>(() =>
		isBuiltinSection(initialSection) ? null : initialSection
	);

	useEffect(() => {
		if (!pendingSection) {
			return;
		}
		const resolved = resolveStoreSection(
			pendingSection,
			BUILTIN_SECTION_VALUES,
			contributedTabs
		);
		if (resolved) {
			setSection(resolved);
			setPendingSection(null);
		}
	}, [pendingSection, contributedTabs]);

	const activeContributedTab = useMemo(
		() => contributedTabForSection(section, contributedTabs),
		[section, contributedTabs]
	);

	// The nav bar's full section list: the shell's own sections with each app's
	// registered tabs spliced into the group it declared, so the divider logic
	// (adjacent same-group pills cluster) keeps working unchanged.
	const navSections = useMemo(() => {
		const out: StoreSectionTab[] = [];
		for (const group of STORE_GROUP_ORDER) {
			for (const s of SECTIONS.filter((b) => b.group === group)) {
				out.push(s);
			}
			for (const tab of contributedTabs.filter(
				(t) => storeTabGroup(t) === group
			)) {
				out.push({
					group,
					icon: tab.icon ?? "grid",
					label: tab.title,
					value: storeTabSectionValue(tab),
				});
			}
		}
		return out;
	}, [contributedTabs]);

	// Store-wide search, live from any section via the nav rail. A non-empty
	// query takes over the content pane with aggregated results.
	const [searchQuery, setSearchQuery] = useState("");
	const search = useStoreSearch(searchQuery);

	// When a store-wide search result opens a realm, the query rides along as that
	// section's initial search; cleared whenever a section is picked manually.
	const [sectionInitialQuery, setSectionInitialQuery] = useState<
		string | undefined
	>(initialQuery);

	// …and when a HOME shelf card opens a realm, the clicked item's id rides along
	// instead, so the section opens with that item's preview rather than with its
	// title typed into the search box. Two separate slots on purpose: a store-wide
	// search result carries a query and no id, a Home card carries an id and no
	// query, and collapsing them would make one of the two lie.
	const [sectionInitialSelectedId, setSectionInitialSelectedId] = useState<
		string | undefined
	>(undefined);

	// The active section publishes its filter panel here; the chrome's toolbar row
	// renders it as a popover button beside the search.
	const [toolbar, setToolbar] = useState<StoreToolbarConfig | null>(null);

	// "Installed only" — the retired "Added" tab as a switch over whichever
	// section is open. Shell state rather than per-section state, so it survives
	// switching tabs: that is the whole point (browse Models installed, then
	// Plugins installed, without re-arming it each time).
	const [installedOnly, setInstalledOnly] = useState(initialInstalledOnly);

	const openRealm = (
		realm: StoreSearchRealm,
		query: string,
		itemId?: string
	) => {
		setSectionInitialQuery(query.trim() || undefined);
		setSectionInitialSelectedId(itemId || undefined);
		setSearchQuery("");
		setSection(realm);
	};

	const selectSection = useCallback(
		(value: string) => {
			const resolved = resolveStoreSection(
				value,
				BUILTIN_SECTION_VALUES,
				contributedTabs
			);
			if (resolved) {
				setSectionInitialQuery(undefined);
				// A manual tab pick must drop a stale preselect too, or the section
				// re-opens the last Home card's preview when the user comes back to it.
				setSectionInitialSelectedId(undefined);
				setSearchQuery("");
				setPendingSection(null);
				setSection(resolved);
			}
		},
		[contributedTabs]
	);

	const searching = search.hasQuery || searchQuery.trim().length > 0;
	// Between the first keystroke and the debounced query firing, show the
	// spinner instead of a premature "Nothing found".
	const searchPending = searchQuery.trim().length > 0 && !search.hasQuery;

	// The Models tab keeps its full-width master-detail layout and publishes its
	// rich filters up here; every other (carded) section renders its own filter
	// button beside its list, so only Models fills this slot.
	const sectionFilters = section === "models" ? toolbar : null;
	// …and because Models is full-bleed, the chrome above it must be too. A
	// centered `max-w-4xl` search + tab strip sitting over an edge-to-edge
	// master-detail pane is the one place the shell visibly stopped being one
	// page.
	const fullBleed = section === "models";

	return (
		<DesktopMarketplaceHost>
			<DesktopCatalogHost>
				<StoreToolbarProvider value={setToolbar}>
					<InstalledOnlyProvider value={installedOnly}>
						<div className="relative flex h-full flex-col overflow-hidden pt-12">
							{/* Page chrome, inline and in the order it works: the global
							    search (with the active section's filters and the
							    installed-only switch beside it), then the section tabs.
							    Aligned to the same column the section below uses — centered
							    for the carded sections, edge-to-edge for the full-bleed
							    Models pane.

							    There is no section TITLE any more. It restated the pill that
							    was already active directly beneath it, and it pushed the one
							    control that searches everything to the bottom of the page,
							    below the tabs that scope a search to one realm. */}
							<div
								className={cn(
									"mx-auto w-full shrink-0 px-4 pt-4",
									fullBleed ? "max-w-none" : "max-w-4xl"
								)}
							>
								<StoreGlobalSearch
									onChange={setSearchQuery}
									placeholder="Search the whole marketplace…"
									trailing={
										<>
											{sectionFilters?.panel ? (
												<Popover>
													<PopoverTrigger
														render={
															<Button className="gap-1.5" variant="ghost">
																<HugeiconsIcon
																	className="size-4"
																	icon={
																		sectionFilters.panelIcon ??
																		SlidersHorizontalIcon
																	}
																/>
																{sectionFilters.panelLabel ?? "Filters"}
															</Button>
														}
													/>
													<PopoverContent
														align="end"
														className="w-[min(30rem,90vw)] p-0"
													>
														{sectionFilters.panel}
													</PopoverContent>
												</Popover>
											) : null}
											<Tooltip>
												<TooltipTrigger
													render={
														<Button
															aria-pressed={installedOnly}
															className="gap-1.5"
															onClick={() => setInstalledOnly((on) => !on)}
															variant={installedOnly ? "secondary" : "ghost"}
														>
															<HugeiconsIcon
																className="size-4"
																icon={Download01Icon}
															/>
															Installed
														</Button>
													}
												/>
												<TooltipContent>
													{installedOnly
														? "Showing only what you have installed"
														: "Show only what you have installed"}
												</TooltipContent>
											</Tooltip>
										</>
									}
									value={searchQuery}
								/>
								<StoreSectionTabs
									active={section}
									className="pt-2 pb-1"
									onSelect={selectSection}
									sections={navSections}
								/>
							</div>
							<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
								{searching ? (
									<StoreSearchResults
										groups={search.groups}
										isEmpty={search.isEmpty}
										loading={search.loading || searchPending}
										onOpenRealm={(realm) => openRealm(realm, searchQuery)}
									/>
								) : (
									<StoreContent
										contributedTab={activeContributedTab}
										initialQuery={sectionInitialQuery}
										initialSelectedId={sectionInitialSelectedId}
										onOpenRealm={openRealm}
										section={section}
									/>
								)}
							</div>
						</div>
					</InstalledOnlyProvider>
				</StoreToolbarProvider>
			</DesktopCatalogHost>
		</DesktopMarketplaceHost>
	);
}

function StoreContent({
	section,
	initialQuery,
	initialSelectedId,
	onOpenRealm,
	contributedTab,
}: {
	/** The app-registered tab this section belongs to, if it is not a built-in. */
	contributedTab: PluginStoreTab | null;
	section: StoreSection;
	/** Seed query carried over from the store-wide search (searchable realms only). */
	initialQuery?: string;
	/** Open this item's preview on arrival — a Home shelf card's id. Forwarded only
	 *  to the six sections that own a per-item preview; Integrations, Engines,
	 *  Account and app-registered tabs have no such concept. */
	initialSelectedId?: string;
	onOpenRealm: (
		realm: StoreSearchRealm,
		query: string,
		itemId?: string
	) => void;
}) {
	if (section === "home") {
		return <StoreHome onOpenRealm={onOpenRealm} />;
	}
	if (section === "integrations") {
		return (
			<IntegrationsCatalogSection
				initialQuery={initialQuery}
				onOpenRealm={onOpenRealm}
			/>
		);
	}
	if (section === "apps") {
		return (
			<AppsCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
				variant="apps"
			/>
		);
	}
	if (section === "plugins") {
		return (
			<AppsCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
				variant="plugins"
			/>
		);
	}
	if (section === "models") {
		return (
			<ModelsCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
			/>
		);
	}
	if (section === "skills") {
		return (
			<SkillsCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
			/>
		);
	}
	if (section === "mcp") {
		return (
			<McpCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
			/>
		);
	}
	if (section === "agents") {
		return (
			<AgentsCatalogSection
				initialQuery={initialQuery}
				initialSelectedId={initialSelectedId}
			/>
		);
	}
	if (section === "engines") {
		return <EnginesCatalogSection />;
	}
	if (section === "account") {
		return <AccountSection />;
	}
	// App-registered tab. EVERY one renders from its declarative spec — there is no
	// per-plugin component table any more. The Workflows tab was the last holder of
	// one, purely so its preview could draw the template graph; that is now the
	// `spec.detail.graph` primitive, which any app can declare (see
	// `ContributedStoreSection`). A first-party escape hatch here is exactly what
	// makes a "you can own a Store section" promise untrue for everyone else.
	if (contributedTab) {
		return (
			<ContributedStoreSection
				initialQuery={initialQuery}
				tab={contributedTab}
			/>
		);
	}
	const meta = SECTIONS.find((s) => s.value === section);
	return (
		<StoreComingSoon
			icon={meta?.icon ?? GridIcon}
			label={meta?.label ?? "This"}
		/>
	);
}
