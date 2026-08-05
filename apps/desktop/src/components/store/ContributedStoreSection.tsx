// apps/desktop/src/components/store/ContributedStoreSection.tsx
//
// The generic renderer for an app-registered Store section
// (`contributes.store_tabs[]`). One component draws every contributed tab from its
// declarative spec — a `source` for the catalog rows, a `groupBy`/`groups` split
// into labelled card rows, a per-tab search, and an `install` action — so shipping a
// marketplace tab is a manifest edit in the owning app, not an edit to this closed
// desktop source. It is the Store-shaped sibling of the sidebar's
// `SidebarSectionSpec` renderer and reuses the same primitives from
// `@ryu/app-host/views`.
//
// Two states this renderer has that no other catalog section has, both consequences
// of store tabs being served for apps that are NOT installed or NOT enabled (see
// `PluginStoreTab`):
//
//   1. The app is absent/off → the catalog behind it is gated by the app's own route
//      gate, so fetching would 403. We render an enable prompt instead, and the
//      button installs + enables the owning app in one go.
//   2. The app was just enabled → the tab re-fetches, no reload.
//
// Chrome is the shared App-Store layout (StoreCatalogLayout + StoreCardGrid +
// StoreCatalogCard), so a contributed tab is visually indistinguishable from Apps,
// Plugins, Models or Skills.

import {
	Alert01Icon,
	CheckmarkCircle02Icon,
	Download01Icon,
	GridIcon,
	Link01Icon,
	Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	groupStoreItems,
	isCoreApiPath,
	renderActionHttp,
	renderTemplate,
	type StoreCatalogItem,
	type StoreTabSpec,
	storeItemHaystack,
	storeItemsFromResponse,
	type ViewAction,
} from "@ryu/app-host/views";
import { InstallProgressButton } from "@ryu/blocks/desktop/install-button";
import StoreCatalogCard from "@ryu/marketplace/catalog/chrome/store-catalog-card";
import StoreCatalogLayout, {
	StoreCardGrid,
} from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import StoreItemAction from "@ryu/marketplace/catalog/chrome/store-item-action";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import { Icon } from "@ryu/ui/components/icon";
import { toast } from "@ryu/ui/components/sileo";
import { Spinner } from "@ryu/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useDebouncedValue } from "@/src/hooks/use-debounced-value.ts";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useApps } from "@/src/hooks/useApps.ts";
import { usePluginSettingsOpener } from "@/src/hooks/usePluginSettingsOpener.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginStoreTab } from "@/src/lib/api/plugins.ts";

const SEARCH_DEBOUNCE_MS = 200;

/** Fallback glyph when neither the tab nor the row declares one. */
const FALLBACK_ICON = GridIcon;

function TabIcon({ icon, className }: { className?: string; icon?: string }) {
	if (icon) {
		return <Icon className={className} icon={icon} size={20} />;
	}
	return <HugeiconsIcon className={className} icon={FALLBACK_ICON} />;
}

/**
 * The prompt shown when a contributed tab's owning app is not installed, or is
 * installed but disabled. The tab itself is always listed (that is the point — this
 * is where the app gets installed from), but its catalog lives behind the app's own
 * route gate, so there is nothing to fetch until the app is on.
 */
function AppOffState({
	tab,
	onEnabled,
}: {
	onEnabled: () => void;
	tab: PluginStoreTab;
}) {
	const { install, toggle } = useApps();
	const [busy, setBusy] = useState(false);
	// An installed-but-disabled app can be configured before it is turned on — that
	// is often the point (paste the key, then enable). Absent for an app that isn't
	// installed yet: there is nothing on this node to configure.
	const openSettings = usePluginSettingsOpener()(tab.plugin);

	const handleEnable = async () => {
		setBusy(true);
		try {
			if (!tab.app_installed) {
				await install(tab.plugin);
			}
			await toggle(tab.plugin, true);
			toast.success(`${tab.title} is ready`);
			onEnabled();
		} catch (e) {
			toast.error("Couldn't enable the app", {
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Empty className="h-full p-6">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<TabIcon icon={tab.icon} />
				</EmptyMedia>
				<EmptyTitle>Turn on {tab.title}</EmptyTitle>
				<EmptyDescription>
					{tab.subtitle ??
						"This catalog is provided by an app that isn't running yet."}
				</EmptyDescription>
			</EmptyHeader>
			<div className="flex items-center gap-2">
				<InstallProgressButton installing={busy} onClick={handleEnable}>
					<HugeiconsIcon className="size-4" icon={Download01Icon} />
					{tab.app_installed ? "Enable" : "Install"}
				</InstallProgressButton>
				{openSettings ? (
					<Button onClick={openSettings} size="sm" variant="outline">
						<HugeiconsIcon className="size-4" icon={Settings01Icon} />
						Settings
					</Button>
				) : null}
			</div>
		</Empty>
	);
}

function ItemBadges({ item }: { item: StoreCatalogItem }) {
	return (
		<>
			{item.badge ? <Badge variant="secondary">{item.badge}</Badge> : null}
			{item.tags.slice(0, 3).map((tag) => (
				<Badge key={tag} variant="outline">
					{tag}
				</Badge>
			))}
		</>
	);
}

function InstalledPill() {
	return (
		<Badge variant="secondary">
			<HugeiconsIcon className="size-3" icon={CheckmarkCircle02Icon} />
			Added
		</Badge>
	);
}

function DetailPanel({
	tab,
	item,
	busy,
	installed,
	error,
	onInstall,
	runAction,
}: {
	busy: boolean;
	error: string | null;
	installed: boolean;
	item: StoreCatalogItem | null;
	onInstall: () => void;
	runAction: (action: ViewAction, item: StoreCatalogItem) => void;
	tab: PluginStoreTab;
}) {
	if (!item) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TabIcon icon={tab.icon} />
					</EmptyMedia>
					<EmptyTitle>Nothing selected</EmptyTitle>
					<EmptyDescription>
						Pick an item on the left to review it before installing.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	const installSpec = tab.spec?.install;
	return (
		<div className="scroll-fade-effect-y flex h-full flex-col gap-6 overflow-auto p-4">
			<header className="flex flex-col gap-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<TabIcon
							className="size-8 shrink-0 text-muted-foreground"
							icon={item.icon ?? tab.icon}
						/>
						<h2 className="truncate font-semibold text-xl">{item.title}</h2>
					</div>
					{installSpec ? (
						<InstallAction
							busy={busy}
							installed={installed}
							label={installSpec.label}
							onInstall={onInstall}
						/>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ItemBadges item={item} />
				</div>
				<p className="text-muted-foreground text-sm">
					{item.description || "No description provided."}
				</p>
				{item.sourceUrl ? (
					<a
						className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
						href={item.sourceUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						<HugeiconsIcon className="size-4" icon={Link01Icon} />
						Source
					</a>
				) : null}
				{error ? (
					<p className="flex items-center gap-1.5 text-destructive text-sm">
						<HugeiconsIcon className="size-4 shrink-0" icon={Alert01Icon} />
						{error}
					</p>
				) : null}
				{/* Declared per-item extras (Preview, Duplicate, …) fire against the
				    SELECTED row, so they live here rather than on the card — a card-level
				    slot would have to pick a row before the user did. */}
				{tab.spec?.itemActions?.length ? (
					<div className="flex flex-wrap gap-2">
						{tab.spec.itemActions.map((action) => (
							<Button
								key={action.id}
								onClick={() => runAction(action, item)}
								size="sm"
								variant={action.style === "danger" ? "destructive" : "outline"}
							>
								{action.label}
							</Button>
						))}
					</div>
				) : null}
			</header>
		</div>
	);
}

/** Install affordance in the detail pane: a button until installed, then a
 *  non-interactive "Added" pill (a contributed catalog declares no uninstall, so
 *  surfacing one would be a promise the spec cannot keep). */
function InstallAction({
	installed,
	busy,
	label,
	onInstall,
}: {
	busy: boolean;
	installed: boolean;
	label?: string;
	onInstall: () => void;
}) {
	if (installed) {
		return <InstalledPill />;
	}
	return (
		<InstallProgressButton
			idleVariant="ghost"
			installing={busy}
			onClick={onInstall}
		>
			<HugeiconsIcon className="size-4" icon={Download01Icon} />
			{label ?? "Install"}
		</InstallProgressButton>
	);
}

/** Card-level install affordance — same rule as the detail pane's, and the same
 *  verb: a spec that calls its action "Use" must not say "Install" on the card and
 *  "Use" in the detail pane for the same item. `StoreItemAction` hardcodes
 *  "Install", so a declared label takes the plain button instead. */
function CardAction({
	installed,
	busy,
	label,
	onInstall,
}: {
	busy: boolean;
	installed: boolean;
	label?: string;
	onInstall: () => void;
}) {
	if (installed) {
		return (
			<Button disabled size="sm" variant="secondary">
				Added
			</Button>
		);
	}
	if (label && label !== "Install") {
		return (
			<Button disabled={busy} onClick={onInstall} size="sm" variant="outline">
				{label}
			</Button>
		);
	}
	return (
		<StoreItemAction busy={busy} installed={false} onInstall={onInstall} />
	);
}

/**
 * Read a contributed tab's catalog through the host's authenticated Core seam. The
 * spec only ever names a Core-relative `/api/` path ({@link isCoreApiPath}), so it
 * can never point the node's credentials somewhere else — the same guard the
 * declarative views apply.
 */
function useContributedCatalog(tab: PluginStoreTab, enabled: boolean) {
	const node = useActiveNode();
	const source = tab.spec?.source;
	return useQuery({
		queryKey: ["store-tab-catalog", tab.plugin, tab.id, node.url],
		enabled: enabled && Boolean(source),
		queryFn: async () => {
			if (!source) {
				return [];
			}
			const path = source.http.path;
			if (!isCoreApiPath(path)) {
				throw new Error(`store tab source path must start with /api/: ${path}`);
			}
			const target = toTarget(node);
			const resp = await fetch(apiUrl(target, path), {
				method: source.http.method ?? "GET",
				headers: makeHeaders(target.token),
			});
			if (!resp.ok) {
				throw new Error(`${path} failed: ${resp.status}`);
			}
			return storeItemsFromResponse(
				tab.spec as StoreTabSpec,
				await resp.json()
			);
		},
	});
}

/** Flatten an install response into `{{result.<key>}}` template values. Only scalar
 *  leaves are exposed — a nested object in a route template would stringify to JSON
 *  and produce a broken path. */
function resultValues(payload: unknown): Record<string, unknown> {
	if (typeof payload !== "object" || payload === null) {
		return {};
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (typeof value !== "object" || value === null) {
			out[`result.${key}`] = value;
		}
	}
	return out;
}

export default function ContributedStoreSection({
	tab,
	initialQuery = "",
}: {
	initialQuery?: string;
	tab: PluginStoreTab;
}) {
	const [query, setQuery] = useState(initialQuery);
	const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [errorId, setErrorId] = useState<string | null>(null);
	const [installError, setInstallError] = useState<string | null>(null);
	// Installs performed in this session. A contributed catalog need not report
	// installed-state back (the workflow catalog does not), so this is the floor;
	// `spec.map.installed` layers server truth on top when the app provides it.
	const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

	const node = useActiveNode();
	const queryClient = useQueryClient();
	const { openTab } = useTabsContext();
	const spec = tab.spec;
	const catalog = useContributedCatalog(tab, tab.app_enabled);

	const groups = useMemo(() => {
		if (!spec) {
			return [];
		}
		const q = debouncedQuery.trim().toLowerCase();
		const rows = (catalog.data ?? []).filter(
			(item) => !q || storeItemHaystack(spec, item).includes(q)
		);
		return groupStoreItems(spec, rows);
	}, [spec, catalog.data, debouncedQuery]);

	const selected = useMemo(() => {
		for (const group of groups) {
			const found = group.items.find((i) => i.id === selectedId);
			if (found) {
				return found;
			}
		}
		return null;
	}, [groups, selectedId]);

	// When the catalog reports installed-state itself (`map.installed`), that is the
	// ONLY truth — unioning the session set would be wrong for a single-select
	// catalog like meeting-note styles, where picking a second card must un-mark the
	// first. The session set exists solely for catalogs that report nothing back
	// (the workflow template catalog mints a new workflow and forgets).
	const reportsInstalled = Boolean(spec?.map?.installed);
	const isInstalled = useCallback(
		(item: StoreCatalogItem) =>
			reportsInstalled ? item.installed : installedIds.has(item.id),
		[reportsInstalled, installedIds]
	);

	const runAction = useCallback(
		async (action: ViewAction, item: StoreCatalogItem) => {
			if (!action.http) {
				return;
			}
			// The declarative confirm gate, same as PluginViewPage's: a spec-declared
			// prompt before a destructive action.
			if (action.confirm && !window.confirm(action.confirm)) {
				return;
			}
			const target = toTarget(node);
			const rendered = renderActionHttp(action.http, { item: item.raw });
			const resp = await fetch(apiUrl(target, rendered.path), {
				method: rendered.method,
				headers: makeHeaders(target.token),
				body:
					rendered.body === undefined
						? undefined
						: JSON.stringify(rendered.body),
			});
			if (!resp.ok) {
				throw new Error(`${rendered.path} failed: ${resp.status}`);
			}
			await queryClient.invalidateQueries({
				queryKey: ["store-tab-catalog", tab.plugin, tab.id],
			});
		},
		[node, queryClient, tab.plugin, tab.id]
	);

	const handleInstall = useCallback(
		async (item: StoreCatalogItem) => {
			const install = spec?.install;
			if (!install) {
				return;
			}
			setPendingId(item.id);
			setErrorId(null);
			setInstallError(null);
			try {
				const target = toTarget(node);
				const rendered = renderActionHttp(install.http, { item: item.raw });
				const resp = await fetch(apiUrl(target, rendered.path), {
					method: rendered.method,
					headers: makeHeaders(target.token),
					body:
						rendered.body === undefined
							? undefined
							: JSON.stringify(rendered.body),
				});
				if (!resp.ok) {
					throw new Error(`${rendered.path} failed: ${resp.status}`);
				}
				const payload: unknown = await resp.json().catch(() => ({}));
				setInstalledIds((prev) => new Set(prev).add(item.id));
				toast.success(install.successMessage ?? "Installed", {
					description: `${item.title} is ready.`,
				});
				await queryClient.invalidateQueries({
					queryKey: ["store-tab-catalog", tab.plugin, tab.id],
				});
				// Open what was just created. `targetFrom` names the response key
				// holding its id; `openTarget` is the route template, resolving
				// `{{result.<key>}}` from the response and `{{item.<key>}}` from the row.
				if (install.openTarget) {
					const values = resultValues(payload);
					if (install.targetFrom && values[`result.${install.targetFrom}`]) {
						values["result.id"] = values[`result.${install.targetFrom}`];
					}
					// A CLIENT route, not a Core path — so it goes through the raw
					// template renderer, not `renderActionHttp` (whose `/api/` guard
					// exists to keep the node's credentials pointed at Core and would
					// reject every legitimate route here).
					openTab(
						renderTemplate(
							install.openTarget,
							{ item: item.raw, values },
							{
								uriEncode: true,
							}
						),
						{ title: item.title }
					);
				}
			} catch (e) {
				setErrorId(item.id);
				setInstallError(e instanceof Error ? e.message : String(e));
			} finally {
				setPendingId(null);
			}
		},
		[spec, node, queryClient, tab.plugin, tab.id, openTab]
	);

	if (!tab.app_enabled) {
		return (
			<AppOffState
				onEnabled={() => {
					queryClient.invalidateQueries({ queryKey: ["plugin-contributions"] });
				}}
				tab={tab}
			/>
		);
	}

	if (!spec?.source) {
		return (
			<Empty className="h-full p-6">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TabIcon icon={tab.icon} />
					</EmptyMedia>
					<EmptyTitle>{tab.title}</EmptyTitle>
					<EmptyDescription>
						This tab declares no catalog to browse.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const total = groups.reduce((n, g) => n + g.items.length, 0);

	return (
		<StoreCatalogLayout
			detail={
				<DetailPanel
					busy={pendingId === selected?.id}
					error={errorId === selected?.id ? installError : null}
					installed={selected ? isInstalled(selected) : false}
					item={selected}
					onInstall={() => {
						if (selected) {
							handleInstall(selected);
						}
					}}
					runAction={(action, item) => {
						runAction(action, item).catch((e: unknown) => {
							toast.error(`${action.label} failed`, {
								description: e instanceof Error ? e.message : String(e),
							});
						});
					}}
					tab={tab}
				/>
			}
			detailTitle={selected?.title ?? tab.title}
			hasSelection={selected != null}
			list={
				<CatalogList
					error={catalog.error instanceof Error ? catalog.error.message : null}
					groups={groups}
					isInstalled={isInstalled}
					loading={catalog.isLoading}
					onInstall={handleInstall}
					onSelect={setSelectedId}
					pendingId={pendingId}
					selectedId={selectedId}
					spec={spec}
					tab={tab}
					total={total}
				/>
			}
			onCloseDetail={() => setSelectedId(null)}
			search={{
				value: query,
				onChange: setQuery,
				placeholder: spec.searchPlaceholder ?? `Search ${tab.title}…`,
			}}
		/>
	);
}

function CatalogList({
	tab,
	spec,
	groups,
	total,
	loading,
	error,
	selectedId,
	pendingId,
	isInstalled,
	onSelect,
	onInstall,
}: {
	error: string | null;
	groups: { items: StoreCatalogItem[]; label: string; value: string }[];
	isInstalled: (item: StoreCatalogItem) => boolean;
	loading: boolean;
	onInstall: (item: StoreCatalogItem) => void;
	onSelect: (id: string) => void;
	pendingId: string | null;
	selectedId: string | null;
	spec: StoreTabSpec;
	tab: PluginStoreTab;
	total: number;
}) {
	if (loading && total === 0) {
		return (
			<div className="flex items-center justify-center p-8 text-muted-foreground">
				<Spinner className="size-5" />
			</div>
		);
	}
	if (error && total === 0) {
		return (
			<div className="p-4 text-destructive text-sm">
				Couldn't load {tab.title}: {error}
			</div>
		);
	}
	if (total === 0) {
		return (
			<Empty className="h-full p-6">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TabIcon icon={tab.icon} />
					</EmptyMedia>
					<EmptyTitle>{spec.empty?.title ?? "Nothing found"}</EmptyTitle>
					<EmptyDescription>
						{spec.empty?.description ?? "Try a different search."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div>
			{groups.map((group) => (
				<section className="mb-6" key={group.value || "all"}>
					{group.label ? (
						<h3 className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-widest">
							{group.label}
						</h3>
					) : null}
					<StoreCardGrid>
						{group.items.map((item) => (
							<StoreCatalogCard
								action={
									spec.install ? (
										<CardAction
											busy={pendingId === item.id}
											installed={isInstalled(item)}
											label={spec.install.label}
											onInstall={() => onInstall(item)}
										/>
									) : undefined
								}
								description={item.description}
								icon={
									<TabIcon className="size-5" icon={item.icon ?? tab.icon} />
								}
								key={item.id}
								name={item.title}
								onClick={() => onSelect(item.id)}
								seedId={item.id}
								selected={item.id === selectedId}
							/>
						))}
					</StoreCardGrid>
				</section>
			))}
		</div>
	);
}
