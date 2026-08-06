// apps/desktop/src/components/store/AgentsCatalogSection.tsx
//
// The Agents section in the Store. Browses Core's agent catalog
// (`GET /api/agents/catalog`): every built-in agent (the flagship "Ryu" Pi+Gateway
// plus the full ACP registry (Claude Agent, Codex, Cursor, Devin, …) loaded
// from the official CDN. It drives the install/uninstall lifecycle that adds or removes an agent
// from the installed set surfaced in the chat picker.
//
// Uses the shared Store master-detail layout (left list, right preview) like
// Plugins, Models, MCP, and Skills. Two per-entry signals are surfaced as badges:
//   - `added`    → the agent is installed (in the picker). Drives the button mode.
//   - `detected` → the agent's CLI binary is on PATH (null when not detectable),
//     a hint that the agent is ready to run locally without a separate install.
// Recommended agents (the flagship) sort first and carry a "Recommended" badge.
// The flagship `ryu` is locked: it is always installed and cannot be removed.
//
// The list is GROUPED (Workflows/Engines shape): Installed → On this machine →
// Popular → More agents → Needs manual install. The groups are a presentation of
// the flags above, never a filter — every catalog row lands in exactly one group,
// so nothing can silently disappear from the tab. Precedence is top-down, which
// is what keeps them mutually exclusive (an installed agent that is also detected
// shows once, under Installed). Searching flattens back to a single grid, the
// same way the Tools library behaves.

import {
	Alert01Icon,
	Delete01Icon,
	Download01Icon,
	Loading01Icon,
	Robot01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InstallProgressButton } from "@ryu/blocks/desktop/install-button";
import StoreCatalogCard from "@ryu/marketplace/catalog/chrome/store-catalog-card";
import StoreCatalogLayout, {
	StoreCardGrid,
} from "@ryu/marketplace/catalog/chrome/store-catalog-layout";
import StoreItemAction, {
	StoreItemContextMenuContent,
} from "@ryu/marketplace/catalog/chrome/store-item-action";
import {
	ListingAsideCard,
	ListingDetailShell,
	ListingHero,
	ListingInfoGrid,
	ListingSection,
	ListingStatStrip,
} from "@ryu/marketplace/catalog/detail/listing-detail-shell";
import { Button } from "@ryu/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ryu/ui/components/empty";
import { Spinner } from "@ryu/ui/components/spinner";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/src/hooks/use-debounced-value.ts";
import { useAgentsCatalog } from "@/src/hooks/useAgentsCatalog.ts";
import {
	type PluginSettingsOpener,
	usePluginSettingsOpener,
} from "@/src/hooks/usePluginSettingsOpener.ts";
import { groupAgents } from "@/src/lib/agent-catalog-groups.ts";
import { AgentCatalogLogo } from "@/src/lib/agent-catalog-logo.tsx";
import type { AgentCatalogEntry } from "@/src/lib/api/agents.ts";
import { useInstallProgress } from "@/src/store/useDownloadsStore.ts";

const SEARCH_DEBOUNCE_MS = 200;

/** The flagship agent: always installed, cannot be uninstalled. */
const FLAGSHIP_AGENT_ID = "ryu";

/** Sort recommended agents first, then by display name. */
function sortAgents(agents: AgentCatalogEntry[]): AgentCatalogEntry[] {
	return [...agents].sort((a, b) => {
		if (a.recommended !== b.recommended) {
			return a.recommended ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

function InstallButton({
	entry,
	busy,
	onInstall,
	onUninstall,
}: {
	entry: AgentCatalogEntry;
	busy: boolean;
	onInstall: () => void;
	onUninstall: () => void;
}) {
	const locked = entry.id === FLAGSHIP_AGENT_ID;
	const { percent } = useInstallProgress(["agent"], entry.name);
	if (entry.added) {
		return (
			<Button
				disabled={busy || locked}
				onClick={onUninstall}
				size="sm"
				variant="ghost"
			>
				{busy ? (
					<HugeiconsIcon className="size-4 animate-spin" icon={Loading01Icon} />
				) : (
					<HugeiconsIcon className="size-4" icon={Delete01Icon} />
				)}
				{locked ? "Built in" : "Uninstall"}
			</Button>
		);
	}
	if (!entry.available) {
		return (
			<Button disabled size="sm" variant="ghost">
				<HugeiconsIcon className="size-4" icon={Alert01Icon} />
				Unavailable
			</Button>
		);
	}
	return (
		<InstallProgressButton
			idleVariant="ghost"
			installing={busy}
			onClick={onInstall}
			percent={percent}
		>
			<HugeiconsIcon className="size-4" icon={Download01Icon} />
			Install
		</InstallProgressButton>
	);
}

/** Card lifecycle control: locked flagship, unavailable, or install/uninstall. */
function AgentCardAction({
	entry,
	busy,
	onInstall,
	onUninstall,
	onOpenSettings,
}: {
	entry: AgentCatalogEntry;
	busy: boolean;
	onInstall: () => void;
	onUninstall: () => void;
	/** Set only for a listing that is ALSO an installed plugin with settings —
	 *  most agents are not, and then no Settings row renders. */
	onOpenSettings?: (() => void) | null;
}) {
	const { percent } = useInstallProgress(["agent"], entry.name);
	if (entry.id === FLAGSHIP_AGENT_ID) {
		return (
			<StoreItemAction
				installed
				locked
				lockedLabel="Built in"
				onOpenSettings={onOpenSettings ?? undefined}
			/>
		);
	}
	if (!(entry.available || entry.added)) {
		return (
			<Button disabled size="sm" variant="ghost">
				<HugeiconsIcon className="size-4" icon={Alert01Icon} />
				Unavailable
			</Button>
		);
	}
	return (
		<StoreItemAction
			busy={busy}
			installed={entry.added}
			onInstall={onInstall}
			onOpenSettings={onOpenSettings ?? undefined}
			onUninstall={onUninstall}
			percent={percent}
		/>
	);
}

function AgentCards({
	agents,
	selectedId,
	pendingId,
	onSelect,
	onInstall,
	onUninstall,
	settingsOpener,
}: {
	agents: AgentCatalogEntry[];
	selectedId: string | null;
	pendingId: string | null;
	onSelect: (id: string) => void;
	onInstall: (id: string) => void;
	onUninstall: (id: string) => void;
	/** Resolves a row to its settings tab; null for anything that is not an
	 *  installed plugin, which is most agents. */
	settingsOpener: PluginSettingsOpener;
}) {
	return (
		<StoreCardGrid>
			{agents.map((entry) => (
				<StoreCatalogCard
					action={
						<AgentCardAction
							busy={pendingId === entry.id}
							entry={entry}
							onInstall={() => onInstall(entry.id)}
							onOpenSettings={settingsOpener(entry.id)}
							onUninstall={() => onUninstall(entry.id)}
						/>
					}
					brandIcon={
						<AgentCatalogLogo
							className="size-5 opacity-90"
							entry={entry}
							size="20px"
						/>
					}
					contextMenu={
						!entry.added && (entry.available || entry.added) ? (
							<StoreItemContextMenuContent
								canReport={false}
								onInstall={() => onInstall(entry.id)}
								onReport={() => undefined}
							/>
						) : undefined
					}
					description={entry.description}
					icon={<HugeiconsIcon icon={Robot01Icon} />}
					key={entry.id}
					name={entry.name}
					onClick={() => onSelect(entry.id)}
					selected={entry.id === selectedId}
				/>
			))}
		</StoreCardGrid>
	);
}

function AgentList({
	agents,
	grouped,
	loading,
	error,
	selectedId,
	pendingId,
	onSelect,
	onInstall,
	onUninstall,
	settingsOpener,
}: {
	agents: AgentCatalogEntry[];
	/** False while searching: results collapse into a single ungrouped grid. */
	grouped: boolean;
	loading: boolean;
	error: string | null;
	selectedId: string | null;
	pendingId: string | null;
	onSelect: (id: string) => void;
	onInstall: (id: string) => void;
	onUninstall: (id: string) => void;
	settingsOpener: PluginSettingsOpener;
}) {
	if (loading && agents.length === 0) {
		return (
			<div className="flex items-center justify-center p-8 text-muted-foreground">
				<Spinner className="size-5" />
			</div>
		);
	}
	if (error && agents.length === 0) {
		return (
			<div className="p-4 text-destructive text-sm">
				Couldn't load agents: {error}
			</div>
		);
	}
	if (agents.length === 0) {
		return (
			<Empty className="h-full p-6">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={Robot01Icon} />
					</EmptyMedia>
					<EmptyTitle>No agents found</EmptyTitle>
					<EmptyDescription>Try a different search.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const cardProps = {
		onInstall,
		onSelect,
		onUninstall,
		pendingId,
		selectedId,
		settingsOpener,
	};
	if (!grouped) {
		return <AgentCards agents={agents} {...cardProps} />;
	}
	return (
		<div>
			{groupAgents(agents).map((group) => (
				<section className="mb-6" key={group.key}>
					<h3 className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-widest">
						{group.label}
					</h3>
					<AgentCards agents={group.items} {...cardProps} />
				</section>
			))}
		</div>
	);
}

function AgentDetailPanel({
	entry,
	busy,
	error,
	onInstall,
	onUninstall,
}: {
	entry: AgentCatalogEntry | null;
	busy: boolean;
	error: string | null;
	onInstall: () => void;
	onUninstall: () => void;
}) {
	if (!entry) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HugeiconsIcon icon={Robot01Icon} />
					</EmptyMedia>
					<EmptyTitle>No agent selected</EmptyTitle>
					<EmptyDescription>
						Pick an agent on the left to review its details and install it.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const updateAvailable =
		entry.versionStatus === "behind_latest" ||
		entry.bridgeVersionStatus === "behind_latest";

	return (
		<ListingDetailShell
			actions={
				<>
					<InstallButton
						busy={busy}
						entry={entry}
						onInstall={onInstall}
						onUninstall={onUninstall}
					/>
					{error && (
						<span className="ml-auto flex items-center gap-1.5 text-destructive text-sm">
							<HugeiconsIcon className="size-4 shrink-0" icon={Alert01Icon} />
							{error}
						</span>
					)}
				</>
			}
			aside={
				<ListingAsideCard title="Information">
					<ListingInfoGrid
						rows={[
							{ label: "Engine", value: entry.engine ?? "—" },
							{ label: "Transport", value: entry.transport ?? "—" },
							{ label: "Registry ID", value: entry.registryId ?? "—" },
							{
								label: "On PATH",
								value:
									entry.detected === null
										? "Unknown"
										: entry.detected
											? "Yes"
											: "No",
							},
							{
								label: "Gateway",
								value: entry.gatewayBypass ? "Bypassed" : "Routed",
							},
						]}
					/>
				</ListingAsideCard>
			}
			hero={
				<ListingHero
					badges={[
						entry.added ? "Installed" : "Not installed",
						entry.recommended ? "Recommended" : null,
						entry.available ? null : "Unavailable on this platform",
						updateAvailable ? "Update available" : null,
					].filter((b): b is string => Boolean(b))}
					icon={
						<AgentCatalogLogo
							className="size-9 opacity-90"
							entry={entry}
							size="36px"
						/>
					}
					name={entry.name}
					tagline={entry.description}
				/>
			}
			stats={
				<ListingStatStrip
					items={[
						{
							label: "Agent",
							sub: entry.latestVersion
								? `Latest v${entry.latestVersion}`
								: undefined,
							value: entry.installedVersion
								? `v${entry.installedVersion}`
								: (entry.latestVersion ?? "—"),
						},
						{
							label: "Bridge",
							sub: entry.latestBridgeVersion
								? `Latest v${entry.latestBridgeVersion}`
								: undefined,
							value: entry.installedBridgeVersion
								? `v${entry.installedBridgeVersion}`
								: (entry.latestBridgeVersion ?? "—"),
						},
						{ label: "Engine", value: entry.engine ?? "—" },
						{ label: "Transport", value: entry.transport ?? "—" },
						{
							label: "Status",
							value: entry.added ? "Installed" : "Available",
						},
					]}
				/>
			}
		>
			<ListingSection title="About">
				<p className="text-muted-foreground text-sm leading-relaxed">
					{entry.description ?? "No description provided."}
				</p>
			</ListingSection>
			{entry.installHint ? (
				<ListingSection title="Installing">
					<p className="text-muted-foreground text-sm">{entry.installHint}</p>
				</ListingSection>
			) : null}
		</ListingDetailShell>
	);
}

export default function AgentsCatalogSection({
	initialQuery = "",
}: {
	initialQuery?: string;
} = {}) {
	const [query, setQuery] = useState(initialQuery);
	const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// A few catalog rows are ALSO installed plugins that declare settings; the
	// resolver returns null for the rest, so the row simply has no Settings entry.
	const settingsOpener = usePluginSettingsOpener();
	const { agents, loading, error, install, uninstall, pendingId } =
		useAgentsCatalog();
	const [errorId, setErrorId] = useState<string | null>(null);

	const sorted = useMemo(() => sortAgents(agents), [agents]);

	const filtered = useMemo(() => {
		const q = debouncedQuery.trim().toLowerCase();
		if (!q) {
			return sorted;
		}
		return sorted.filter(
			(entry) =>
				entry.name.toLowerCase().includes(q) ||
				(entry.description?.toLowerCase().includes(q) ?? false)
		);
	}, [sorted, debouncedQuery]);

	const selectedEntry = useMemo(
		() => filtered.find((entry) => entry.id === selectedId) ?? null,
		[filtered, selectedId]
	);

	const run = async (id: string, action: () => Promise<void>) => {
		setErrorId(null);
		try {
			await action();
		} catch {
			setErrorId(id);
		}
	};

	return (
		<StoreCatalogLayout
			detail={
				<AgentDetailPanel
					busy={pendingId === selectedId}
					entry={selectedEntry}
					error={errorId === selectedId ? error : null}
					onInstall={() => {
						if (selectedId) {
							run(selectedId, () => install(selectedId));
						}
					}}
					onUninstall={() => {
						if (selectedId) {
							run(selectedId, () => uninstall(selectedId));
						}
					}}
				/>
			}
			detailTitle={selectedEntry?.name ?? "Agent"}
			hasSelection={selectedEntry != null}
			list={
				<AgentList
					agents={filtered}
					error={error}
					grouped={debouncedQuery.trim().length === 0}
					loading={loading}
					onInstall={(id) => run(id, () => install(id))}
					onSelect={setSelectedId}
					onUninstall={(id) => run(id, () => uninstall(id))}
					pendingId={pendingId}
					selectedId={selectedId}
					settingsOpener={settingsOpener}
				/>
			}
			onCloseDetail={() => setSelectedId(null)}
			search={{
				value: query,
				onChange: setQuery,
				placeholder: "Search agents…",
			}}
		/>
	);
}
