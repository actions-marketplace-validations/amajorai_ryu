import {
	CpuIcon,
	Download01Icon,
	GridIcon,
	Home01Icon,
	Link01Icon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import {
	StoreComingSoon,
	StoreSectionNav,
	type StoreSectionTab,
} from "@ryu/blocks/desktop/store";
import { StoreCatalogHeaderProvider } from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import { REALM_ICONS } from "@ryu/marketplace/catalog/realm-icons";
import {
	type ReactElement,
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
import InstalledSection from "@/src/components/store/InstalledSection.tsx";
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
import WorkflowTemplatesSection from "@/src/components/store/WorkflowTemplatesSection.tsx";
import {
	contributedTabForSection,
	resolveStoreSection,
	STORE_GROUP_ORDER,
	storeTabGroup,
	storeTabSectionValue,
	useContributedStoreTabs,
} from "@/src/hooks/useContributedStoreTabs.ts";
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
	| "installed"
	| "account";

/** An active section value: a {@link BuiltinStoreSection}, or a contributed tab's
 *  `plugin:<pluginId>:<tabId>` key. Deliberately open — the Store's section list is
 *  no longer a closed union the shell can enumerate at compile time. */
type StoreSection = string;

const SECTIONS: {
	value: BuiltinStoreSection;
	label: string;
	icon: IconSvgElement;
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
	{
		value: "agents",
		label: "Agents",
		icon: REALM_ICONS.agents,
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
	// Manage — what you already have installed, and the nodes running it.
	//
	// Tools is deliberately NOT here: the MCP servers registered on this node and
	// the tools they expose now live in the Library (`/tools`), because the Store is
	// where you FIND things to add and that surface manages what is already
	// installed. Browse the MCP catalog under "MCP" above.
	//
	// Cross-node health + per-node sidecar controls live in the node selector
	// (shell); this section covers everything installed on the active node.
	{
		value: "installed",
		label: "Installed",
		icon: Download01Icon,
		group: "manage",
	},
	// Account — Marketplace money layer: licenses, selling, connections.
	{ value: "account", label: "Account", icon: Wallet01Icon, group: "account" },
];

const BUILTIN_SECTION_VALUES = SECTIONS.map((s) => s.value);

function isBuiltinSection(value: string): value is BuiltinStoreSection {
	return (BUILTIN_SECTION_VALUES as string[]).includes(value);
}

/** Per-section two-line header (title + one-line description), shown above the
 *  active section's content pane. The typography mirrors the onboarding card
 *  headers (`onboarding.tsx` FeatureStep): a foreground `font-semibold text-lg`
 *  title over a muted `text-sm` subtext, so the whole app reads as one system. */
const SECTION_HEADERS: Record<
	BuiltinStoreSection,
	{ title: string; subtitle: string }
> = {
	home: {
		title: "Home",
		subtitle: "Featured picks and fresh arrivals from across the marketplace.",
	},
	integrations: {
		title: "Integrations",
		subtitle:
			"Find the service you use, then everything that connects to it in one place.",
	},
	apps: {
		title: "Apps",
		subtitle: "Plugins that ship a companion interface you open inside Ryu.",
	},
	plugins: {
		title: "Plugins",
		subtitle: "Tools, agents, channels, and integrations that extend Ryu.",
	},
	models: {
		title: "Models",
		subtitle: "Download and manage local models to run inference on-device.",
	},
	skills: {
		title: "Skills",
		subtitle: "Reusable instructions your agents load on demand for a task.",
	},
	mcp: {
		title: "MCP",
		subtitle:
			"Connect Model Context Protocol servers to give agents new tools.",
	},
	agents: {
		title: "Agents",
		subtitle: "Prebuilt agents you can install and start using in one click.",
	},
	engines: {
		title: "Engines",
		subtitle:
			"Local inference runtimes for text, image, speech, and embeddings.",
	},
	installed: {
		title: "Installed",
		subtitle: "Everything installed on the active node, gathered in one place.",
	},
	account: {
		title: "Account",
		subtitle: "Licenses, connections, and the marketplace money layer.",
	},
};

/** The header copy for a section: the shell's own table for a built-in, the
 *  contribution's own `title`/`subtitle` for an app-registered tab. */
function sectionHeader(
	section: StoreSection,
	contributed: PluginStoreTab | null
): { subtitle: string; title: string } {
	if (isBuiltinSection(section)) {
		return SECTION_HEADERS[section];
	}
	return {
		title: contributed?.title ?? "Store",
		subtitle: contributed?.subtitle ?? "",
	};
}

function StoreSectionHeader({
	section,
	contributed,
	compact = false,
}: {
	compact?: boolean;
	contributed: PluginStoreTab | null;
	section: StoreSection;
}) {
	const header = sectionHeader(section, contributed);
	return (
		<div className={`shrink-0 px-4 pt-4 ${compact ? "pb-1" : "pb-3"}`}>
			<p className="font-semibold text-lg">{header.title}</p>
		</div>
	);
}

/** Sections that render inside {@link StoreCatalogLayout} — a centered, max-width
 *  card grid with a preview aside. For these the header lives INSIDE the layout
 *  column (via {@link StoreCatalogHeaderProvider}) so title, search and cards
 *  stay aligned even when the aside opens; the rest keep a full-width header. */
const CATALOG_SECTIONS = new Set<BuiltinStoreSection>([
	"integrations",
	"apps",
	"plugins",
	"skills",
	"mcp",
	"agents",
	// Manage sections converted to the same App Store card/preview shape — their
	// header lives inside the centered layout column too, so it must NOT also get
	// the outer full-width StoreSectionHeader (that would render the title twice).
	"engines",
	"installed",
]);

/** Contributed tabs render through {@link ContributedStoreSection}, which is built
 *  on the same `StoreCatalogLayout`, so they belong to the centered-column header
 *  treatment too.
 *
 *  The exception is a contributed tab whose app is OFF: that path renders a bare
 *  enable prompt with no `StoreCatalogLayout`, so nothing consumes the header
 *  provider and the pane would come out titleless. It takes the full-width header
 *  instead — the same treatment the non-carded built-in sections get. */
function usesCatalogLayout(
	section: StoreSection,
	contributed: PluginStoreTab | null
): boolean {
	if (isBuiltinSection(section)) {
		return CATALOG_SECTIONS.has(section);
	}
	return section !== "home" && (contributed?.app_enabled ?? false);
}

/**
 * Unified Store shell, App Store-shaped: a full-width content pane above a
 * floating bottom toolbar (StoreSectionNav — the same pattern as the Library
 * page). The bar carries the section pills (grouped by purpose), the store-wide
 * search folded in, and — for the Models tab only — the rich filter panel. The
 * section is decided once on mount from `initialSection` (driven by the tab path
 * in Layout) and switched in-place from the bar. Typing in the folded search
 * shows aggregated cross-realm results in place of the section; picking a result
 * opens that realm with the query carried over. The Models tab publishes its own
 * filters up into the bar through {@link StoreToolbarProvider}.
 */
export default function StorePage({
	initialSection = "home",
	initialQuery,
}: {
	initialSection?: string;
	/** Seed the active section's search (deep-links carry it, e.g. the
	 *  integrations.sh → MCP-catalog hand-off pre-filters by server name). */
	initialQuery?: string;
}) {
	// App-registered sections. These arrive asynchronously (Core's contributions
	// endpoint), so `initialSection` is resolved against them in an effect below
	// rather than once at mount — a deep link to `/store/workflows` must land on the
	// Workflows tab even though the contribution has not loaded on first render.
	const contributedTabs = useContributedStoreTabs();
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

	// The active section publishes its toolbar here; the floating bottom nav
	// (StoreSectionNav) renders it as its expandable filter panel.
	const [toolbar, setToolbar] = useState<StoreToolbarConfig | null>(null);

	const openRealm = (realm: StoreSearchRealm, query: string) => {
		setSectionInitialQuery(query.trim() || undefined);
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

	// The Models tab keeps its original full-width master-detail layout and
	// publishes its rich filters into the floating bottom bar's expandable panel;
	// every other (carded) section folds its filters into its own top toolbar, so
	// only Models lights up the bottom bar's filter toggle.
	const usesBottomFilterBar = section === "models";

	return (
		<DesktopMarketplaceHost>
			<DesktopCatalogHost>
				<StoreToolbarProvider value={setToolbar}>
					<div className="relative flex h-full flex-col overflow-hidden pt-12">
						<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
							{searching ? (
								<StoreSearchResults
									groups={search.groups}
									isEmpty={search.isEmpty}
									loading={search.loading || searchPending}
									onOpenRealm={(realm) => openRealm(realm, searchQuery)}
								/>
							) : (
								<div className="flex h-full flex-col">
									{/* Catalog sections render their header INSIDE the centered
									    layout column (via the provider); Home renders its own
									    centered header. Only full-width master-detail sections
									    (Models, Tools, …) get the inline full-width header here. */}
									{usesCatalogLayout(section, activeContributedTab) ||
									section === "home" ? null : (
										<StoreSectionHeader
											contributed={activeContributedTab}
											section={section}
										/>
									)}
									<div className="min-h-0 flex-1 overflow-hidden">
										<StoreCatalogHeaderProvider
											header={
												<StoreSectionHeader
													compact
													contributed={activeContributedTab}
													section={section}
												/>
											}
										>
											<StoreContent
												contributedTab={activeContributedTab}
												initialQuery={sectionInitialQuery}
												onOpenRealm={openRealm}
												section={section}
											/>
										</StoreCatalogHeaderProvider>
									</div>
								</div>
							)}
						</div>
						{/* Floating bottom toolbar — same pattern as the Library page
						    (StoreSectionNav): the section pills, the store-wide search
						    folded in, and (Models only) the rich filter panel. */}
						<StoreSectionNav
							active={section}
							onSelect={selectSection}
							panel={usesBottomFilterBar ? toolbar?.panel : undefined}
							panelIcon={usesBottomFilterBar ? toolbar?.panelIcon : undefined}
							panelLabel={usesBottomFilterBar ? toolbar?.panelLabel : undefined}
							search={{
								value: searchQuery,
								onChange: setSearchQuery,
								placeholder: "Search the whole marketplace…",
							}}
							sections={navSections}
						/>
					</div>
				</StoreToolbarProvider>
			</DesktopCatalogHost>
		</DesktopMarketplaceHost>
	);
}

/**
 * Named first-party renderers a `store_tabs` entry may claim through its `view`
 * field, keyed by the OWNING PLUGIN ID — never by the `view` string itself.
 *
 * Same trust gate `EntitySettings.SETTINGS_VIEWS` uses, for the same reason: a
 * third-party manifest can declare `"view": "workflow-templates"` all it likes, but
 * its plugin id is not a key here, so it falls back to the declarative `spec` and
 * can never borrow a first-party component (or the data that component reads).
 */
const STORE_TAB_VIEWS: Record<
	string,
	(props: { initialQuery?: string }) => ReactElement
> = {
	"@ryu/workflows": WorkflowTemplatesSection,
};

function StoreContent({
	section,
	initialQuery,
	onOpenRealm,
	contributedTab,
}: {
	/** The app-registered tab this section belongs to, if it is not a built-in. */
	contributedTab: PluginStoreTab | null;
	section: StoreSection;
	/** Seed query carried over from the store-wide search (searchable realms only). */
	initialQuery?: string;
	onOpenRealm: (realm: StoreSearchRealm, query: string) => void;
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
		return <AppsCatalogSection initialQuery={initialQuery} variant="apps" />;
	}
	if (section === "plugins") {
		return <AppsCatalogSection initialQuery={initialQuery} variant="plugins" />;
	}
	if (section === "models") {
		return <ModelsCatalogSection initialQuery={initialQuery} />;
	}
	if (section === "skills") {
		return <SkillsCatalogSection initialQuery={initialQuery} />;
	}
	if (section === "mcp") {
		return <McpCatalogSection initialQuery={initialQuery} />;
	}
	if (section === "agents") {
		return <AgentsCatalogSection initialQuery={initialQuery} />;
	}
	if (section === "engines") {
		return <EnginesCatalogSection />;
	}
	if (section === "installed") {
		return <InstalledSection />;
	}
	if (section === "account") {
		return <AccountSection />;
	}
	// App-registered tab. A `view` the shell recognises FOR THAT PLUGIN renders its
	// first-party component (the workflow-template graph preview needs more than the
	// declarative vocabulary can express); everything else — including a `view` from a
	// plugin that is not on the allowlist — renders from the declarative spec.
	if (contributedTab) {
		// The enablement gate comes FIRST, before the view allowlist: a first-party
		// component fetches the app's own gated catalog and would render an error when
		// the app is off. The generic renderer is what knows how to offer the install.
		const FirstPartyView =
			contributedTab.view && contributedTab.app_enabled
				? STORE_TAB_VIEWS[contributedTab.plugin]
				: undefined;
		if (FirstPartyView) {
			return <FirstPartyView initialQuery={initialQuery} />;
		}
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
