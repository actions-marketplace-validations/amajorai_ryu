// apps/desktop/src/components/store/IntegrationsCatalogSection.tsx
//
// The Integrations Store tab: a brand-first front door. One card per service
// (Notion, Slack, GitHub, …), merged by Core from the integrations.sh directory
// and Composio's toolkit catalog. Selecting a brand opens a preview that gathers
// everything which connects to it — Skills, MCP servers, Plugins, Agents — by
// running the store-wide search for the brand name and grouping the hits per
// realm, each with a "See all" jump into that realm's own tab (pre-filtered).
//
// The brand card itself is still a pointer rather than an installable unit, but
// its preview is NOT read-only: each directory record folded into the brand
// (`connections`) gets the same action the record-level Apps tab gives it —
// import an `openapi`/`graphql` entry as gateway-governed tools, jump to the MCP
// catalog for an `mcp` entry, or open setup docs. Those actions are imported
// from the marketplace package rather than re-implemented so the two surfaces
// can't drift.

import {
	ArrowRight01Icon,
	Download01Icon,
	LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import InfiniteSentinel from "@ryu/marketplace/catalog/chrome/infinite-sentinel";
import StoreCatalogCard from "@ryu/marketplace/catalog/chrome/store-catalog-card";
import StoreCatalogLayout, {
	StoreCardGrid,
} from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import {
	ListingAsideCard,
	ListingDetailShell,
	ListingHero,
	ListingInfoGrid,
	ListingSection,
	ListingStatStrip,
} from "@ryu/marketplace/catalog/detail/listing-detail-shell";
import ImportToolsAction from "@ryu/marketplace/catalog/import-tools-action";
import { REALM_ICONS } from "@ryu/marketplace/catalog/realm-icons";
import { safeHttpUrl } from "@ryu/marketplace/catalog/safe-url";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { ContextMenuItem } from "@ryu/ui/components/context-menu.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import { Spinner } from "@ryu/ui/components/spinner";
import { useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useIntegrationsCatalog } from "@/src/hooks/useIntegrationsCatalog.ts";
import {
	type StoreSearchRealm,
	useStoreSearch,
} from "@/src/hooks/useStoreSearch.ts";
import type {
	IntegrationBrand,
	IntegrationConnection,
} from "@/src/lib/api/integrations.ts";

/** Which catalog surfaced a brand, as a small chip on the preview. */
const SOURCE_LABELS: Record<string, string> = {
	directory: "Directory",
	composio: "Composio",
};

/** Directory record kinds that name a real connection (the rest — provider tags
 *  like "claude"/"openai", meta like "discovered" — are noise we drop).
 *  `api`/`openapi` both read "API" so the row set stays legible. */
const KIND_LABELS: Record<string, string> = {
	mcp: "MCP",
	api: "API",
	openapi: "API",
	graphql: "GraphQL",
	cli: "CLI",
	rest: "REST",
};

/** Most-actionable kind first, so a brand whose one MCP entry sits behind twenty
 *  OpenAPI ones still leads with the one-click install. */
const KIND_ORDER = ["mcp", "openapi", "graphql", "api", "rest", "cli"];

/** How many connection rows to render before collapsing the tail into a count.
 *  A few multi-service API brands carry a long record list, and the preview is a
 *  preview — the realm tabs below are where you go for depth. */
const MAX_CONNECTION_ROWS = 8;

/** The brand's directory records that name a real connection kind, ordered. */
function actionableConnections(
	connections: IntegrationConnection[]
): IntegrationConnection[] {
	const rank = (kind: string) => {
		const i = KIND_ORDER.indexOf(kind.toLowerCase());
		return i === -1 ? KIND_ORDER.length : i;
	};
	return connections
		.filter((c) => KIND_LABELS[c.kind.toLowerCase()] != null)
		.sort((a, b) => rank(a.kind) - rank(b.kind));
}

export default function IntegrationsCatalogSection({
	initialQuery = "",
	onOpenRealm,
}: {
	initialQuery?: string;
	onOpenRealm: (realm: StoreSearchRealm, query: string) => void;
}) {
	const {
		integrations,
		loading,
		error,
		fetchNextPage,
		hasNextPage,
		loadingMore,
		query,
		setQuery,
	} = useIntegrationsCatalog(initialQuery);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = integrations.find((it) => it.id === selectedId) ?? null;

	return (
		<StoreCatalogLayout
			detail={
				selected ? (
					<IntegrationDetailPanel brand={selected} onOpenRealm={onOpenRealm} />
				) : null
			}
			detailTitle={selected?.name ?? "Integration"}
			hasSelection={selected != null}
			list={
				<IntegrationList
					error={error}
					fetchNextPage={fetchNextPage}
					hasNextPage={hasNextPage}
					integrations={integrations}
					loading={loading}
					loadingMore={loadingMore}
					onSelect={setSelectedId}
					selectedId={selectedId}
				/>
			}
			onCloseDetail={() => setSelectedId(null)}
			search={{
				value: query,
				onChange: setQuery,
				placeholder: "Search integrations (Notion, Slack, GitHub…)",
			}}
		/>
	);
}

/** The one row a brand card's right-click menu can hold: the brand's own site,
 *  the same link its detail header offers. `undefined` — and so no menu at all —
 *  when the directory entry carries no domain. Rendered as a real anchor so it
 *  opens the way every other external link in this file does. */
function brandSiteMenu(domain: string | null | undefined) {
	const href = domain ? safeHttpUrl(`https://${domain}`) : null;
	if (!href) {
		return undefined;
	}
	return (
		<ContextMenuItem
			render={<a href={href} rel="noopener noreferrer" target="_blank" />}
		>
			<HugeiconsIcon className="size-4" icon={LinkSquare01Icon} />
			Open website
		</ContextMenuItem>
	);
}

function IntegrationList({
	integrations,
	loading,
	loadingMore,
	error,
	fetchNextPage,
	hasNextPage,
	selectedId,
	onSelect,
}: {
	integrations: IntegrationBrand[];
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	fetchNextPage: () => void;
	hasNextPage: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (error) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon className="size-5" icon={REALM_ICONS.plugins} />
					</EmptyMedia>
					<EmptyTitle>Couldn't load integrations</EmptyTitle>
					<EmptyDescription>{error}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	if (loading && integrations.length === 0) {
		return (
			<div className="flex h-40 items-center justify-center">
				<Spinner className="size-5" />
			</div>
		);
	}

	if (integrations.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon className="size-5" icon={REALM_ICONS.plugins} />
					</EmptyMedia>
					<EmptyTitle>No integrations found</EmptyTitle>
					<EmptyDescription>Try a different service name.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div>
			<StoreCardGrid>
				{integrations.map((it) => (
					<StoreCatalogCard
						action={null}
						// A brand has no install lifecycle — it is a directory entry — so
						// the one verb worth a menu is the one the detail panel already
						// offers: its own site. A brand with no domain gets no menu.
						contextMenu={brandSiteMenu(it.domain)}
						description={
							it.categories.length > 0
								? it.categories.slice(0, 2).join(" · ")
								: (it.domain ?? null)
						}
						icon={
							<HugeiconsIcon className="size-5" icon={REALM_ICONS.plugins} />
						}
						iconUrl={it.logo}
						key={it.id}
						name={it.name}
						onClick={() => onSelect(it.id)}
						seedId={it.id}
						selected={it.id === selectedId}
					/>
				))}
			</StoreCardGrid>
			<InfiniteSentinel
				hasMore={hasNextPage}
				loading={loadingMore}
				onLoadMore={fetchNextPage}
			/>
		</div>
	);
}

/** The brand preview: a header (logo, name, categories, source chips, site link)
 *  over stacked "related X" sections gathered by the store-wide search. */
function IntegrationDetailPanel({
	brand,
	onOpenRealm,
}: {
	brand: IntegrationBrand;
	onOpenRealm: (realm: StoreSearchRealm, query: string) => void;
}) {
	// Search every realm for the brand name; the hook takes the query reactively
	// (debounced + cached), so selecting a different brand refetches on its own.
	const { groups, loading, isEmpty, hasQuery } = useStoreSearch(brand.name);
	const connections = actionableConnections(brand.connections ?? []);

	const domainHref = brand.domain
		? safeHttpUrl(`https://${brand.domain}`)
		: null;

	return (
		<ListingDetailShell
			actions={
				domainHref ? (
					<Button
						render={
							<a href={domainHref} rel="noopener noreferrer" target="_blank" />
						}
						size="sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-4" icon={LinkSquare01Icon} />
						{brand.domain}
					</Button>
				) : null
			}
			aside={
				<>
					<ListingAsideCard title="Information">
						<ListingInfoGrid
							rows={[
								{ label: "Domain", value: brand.domain ?? "Not listed" },
								{
									label: "Directories",
									value: brand.sources
										.map((s) => SOURCE_LABELS[s] ?? s)
										.join(", "),
								},
								{
									label: "Records",
									value: `${(brand.connections ?? []).length}`,
								},
							]}
						/>
					</ListingAsideCard>
					{brand.categories.length > 0 ? (
						<ListingAsideCard title="Categories">
							<div className="flex flex-wrap gap-1">
								{brand.categories.map((c) => (
									<Badge
										className="font-normal text-xs"
										key={c}
										variant="outline"
									>
										{c}
									</Badge>
								))}
							</div>
						</ListingAsideCard>
					) : null}
				</>
			}
			hero={
				<ListingHero
					badges={brand.sources.map((s) => SOURCE_LABELS[s] ?? s)}
					icon={
						brand.logo ? (
							<img
								alt=""
								className="size-full object-cover"
								loading="lazy"
								src={brand.logo}
							/>
						) : (
							<HugeiconsIcon className="size-8" icon={REALM_ICONS.plugins} />
						)
					}
					name={brand.name}
					tagline={brand.description}
				/>
			}
			stats={
				<ListingStatStrip
					items={[
						{
							label: "Connections",
							sub: "Directory records",
							value: `${connections.length}`,
						},
						{ label: "Categories", value: `${brand.categories.length}` },
						{ label: "Directories", value: `${brand.sources.length}` },
						{
							label: "In catalog",
							value: loading ? "…" : `${groups.length}`,
							sub: "Related realms",
						},
					]}
				/>
			}
		>
			{/* The directory's own records, each with the action its kind supports.
			    Kept separate from the "Related in the catalog" block below — these
			    connect to the service itself, that block is what the catalog already
			    ships about it. */}
			{connections.length > 0 ? (
				<ListingSection title="Available connections">
					<div className="flex flex-col gap-1.5">
						{connections.slice(0, MAX_CONNECTION_ROWS).map((connection) => (
							<ConnectionRow
								brandName={brand.name}
								connection={connection}
								key={connection.id}
								onOpenRealm={onOpenRealm}
							/>
						))}
					</div>
					{connections.length > MAX_CONNECTION_ROWS ? (
						<p className="text-muted-foreground text-xs">
							+{connections.length - MAX_CONNECTION_ROWS} more directory{" "}
							{connections.length - MAX_CONNECTION_ROWS === 1
								? "entry"
								: "entries"}{" "}
							for {brand.name}.
						</p>
					) : null}
				</ListingSection>
			) : null}

			<ListingSection title="Related in the catalog">
				{loading ? (
					<div className="flex h-20 items-center justify-center">
						<Spinner className="size-5" />
					</div>
				) : null}
				{!loading && hasQuery && isEmpty ? (
					<p className="text-muted-foreground text-sm">
						Nothing in the catalog references {brand.name} yet.
					</p>
				) : null}
				<div className="flex flex-col gap-4">
					{groups.map((group) => (
						<RelatedRealmSection
							brandName={brand.name}
							group={group}
							key={group.realm}
							onOpenRealm={onOpenRealm}
						/>
					))}
				</div>
			</ListingSection>
		</ListingDetailShell>
	);
}

/** One directory record, with the action its kind actually supports.
 *
 *  The dispatch mirrors the record-level Apps tab exactly (see
 *  `apps-catalog-section.tsx`): `mcp` hands off to the in-app MCP catalog (backed
 *  by the official registry, which resolves + installs the server), `openapi` and
 *  `graphql` import as gateway-governed `http` tools through Core, and anything
 *  else can only offer its setup docs. Deliberately NOT a badge — a kind chip is
 *  what made this panel unusable while every one of these paths already existed. */
function ConnectionRow({
	connection,
	brandName,
	onOpenRealm,
}: {
	brandName: string;
	connection: IntegrationConnection;
	onOpenRealm: (realm: StoreSearchRealm, query: string) => void;
}) {
	const node = useActiveNode();
	const target = { url: node.url, token: node.token ?? null };
	const kind = connection.kind.toLowerCase();
	const docsHref = safeHttpUrl(connection.url);

	let action: React.ReactNode;
	if (kind === "mcp") {
		action = (
			<Button onClick={() => onOpenRealm("mcp", brandName)} size="sm">
				<HugeiconsIcon className="size-4" icon={Download01Icon} />
				Find in MCP catalog
			</Button>
		);
	} else if (kind === "openapi") {
		action = (
			<ImportToolsAction
				body={{ id: connection.id }}
				endpoint="/api/tools/import/openapi"
				node={target}
			/>
		);
	} else if (kind === "graphql" && connection.url) {
		action = (
			<ImportToolsAction
				body={{ name: connection.name, url: connection.url }}
				endpoint="/api/tools/import/graphql"
				node={target}
			/>
		);
	} else if (docsHref) {
		action = (
			<Button
				render={<a href={docsHref} rel="noopener noreferrer" target="_blank" />}
				size="sm"
				variant="ghost"
			>
				<HugeiconsIcon className="size-4" icon={LinkSquare01Icon} />
				Setup docs
			</Button>
		);
	} else {
		action = (
			<span className="text-muted-foreground text-xs">
				No setup URL on file
			</span>
		);
	}

	return (
		<div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-2">
			<span className="flex min-w-0 items-center gap-2">
				<Badge className="shrink-0" variant="secondary">
					{KIND_LABELS[kind] ?? connection.kind}
				</Badge>
				<span className="truncate text-sm">{connection.name}</span>
			</span>
			<span className="shrink-0">{action}</span>
		</div>
	);
}

/** One "related X" block: the realm's top hits for the brand + a jump to its tab. */
function RelatedRealmSection({
	group,
	brandName,
	onOpenRealm,
}: {
	group: ReturnType<typeof useStoreSearch>["groups"][number];
	brandName: string;
	onOpenRealm: (realm: StoreSearchRealm, query: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Related {group.label}
				</span>
				<Button
					className="h-6 gap-1 px-1.5 text-xs"
					onClick={() => onOpenRealm(group.realm, brandName)}
					size="sm"
					variant="ghost"
				>
					See all
					<HugeiconsIcon className="size-3.5" icon={ArrowRight01Icon} />
				</Button>
			</div>
			<div className="flex flex-col gap-0.5">
				{group.items.map((item) => (
					<button
						className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
						key={item.id}
						onClick={() => onOpenRealm(group.realm, brandName)}
						type="button"
					>
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium text-sm">
								{item.name}
							</span>
							{item.description ? (
								<span className="block truncate text-muted-foreground text-xs">
									{item.description}
								</span>
							) : null}
						</span>
						{item.tag ? (
							<Badge className="shrink-0" variant="outline">
								{item.tag}
							</Badge>
						) : null}
					</button>
				))}
			</div>
		</div>
	);
}
