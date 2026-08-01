// Unified Library page — the single browsing surface for everything the app
// holds (agents, workflows, chats, spaces, teams, meetings, channels,
// identities), modelled on the Store shell (`StorePage`). One section-nav of
// pill tabs switches collections in-place; every tab shares the SAME toolbar +
// card/row (from `@ryu/blocks/desktop/library`) so the views are standardised
// rather than each collection having its own bespoke page.
//
// Two synthetic tabs sit in front: Recents (recently-opened, across all types,
// from the `library` store's stamp-on-open recents) and Favorites (items the
// user starred). Both resolve their stored `{type,id}` refs against the live
// data and silently drop any that no longer resolve (the item was deleted), so
// a stale ref never renders a blank card.

import {
	Add01Icon,
	AudioWave01Icon,
	BookOpen01Icon,
	BubbleChatIcon,
	Clock01Icon,
	DeliverySecure01Icon,
	Key01Icon,
	LibraryIcon,
	StarIcon,
	Target01Icon,
	UserGroupIcon,
	WorkflowCircle06Icon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import {
	LibraryCard,
	type LibraryCardData,
	LibraryEmpty,
	LibraryFilterChip,
	LibraryGrid,
	LibraryLoading,
	type LibrarySortOption,
	LibraryToolbar,
} from "@ryu/blocks/desktop/library";
import { StoreSectionNav } from "@ryu/blocks/desktop/store";
import type { ViewMode } from "@ryu/blocks/desktop/view-toggle";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { SpacePreview } from "@/src/components/library/SpacePreview.tsx";
import { MemoryLibrary } from "@/src/components/memory/MemoryLibrary.tsx";
import { CreateSpaceDialog } from "@/src/components/spaces/CreateSpaceDialog.tsx";
import {
	TeamDialog,
	type TeamDraft,
} from "@/src/components/teams/TeamDialog.tsx";
import ToolsLibrary from "@/src/components/tools/ToolsLibrary.tsx";
import { useChatHistoryContext } from "@/src/contexts/ChatHistoryContext.tsx";
import { useSpacesContext } from "@/src/contexts/SpacesContext.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useApps } from "@/src/hooks/useApps.ts";
import { useChannels } from "@/src/hooks/useChannels.ts";
import { useIdentities } from "@/src/hooks/useIdentities.ts";
import { useMeetings } from "@/src/hooks/useMeetings.ts";
import { useTeams } from "@/src/hooks/useTeams.ts";
import { useWorkflows } from "@/src/hooks/useWorkflows.ts";
import { CHANNEL_LABELS } from "@/src/lib/api/channels.ts";
import {
	type LibraryItemType,
	normalizeTimestamp,
	refKey,
	stampRecent,
	useFavorites,
	useRecents,
} from "@/src/lib/library.ts";
import { WorkflowFlowStrip } from "@/src/lib/workflow-triggers.tsx";

/** A Library tab.
 *
 *  Most tabs are collections of `LibraryItem`s rendered by the shared card/grid
 *  machinery. `"tools"` is not: the MCP servers on the node and the tools they
 *  advertise have their own hierarchy (a tool belongs to a server) and their own
 *  actions (test-call a tool), so it renders a bespoke surface inside the Library
 *  shell — the same escape hatch `"memory"` already uses. */
type LibrarySection = "recents" | "favorites" | "tools" | LibraryItemType; // agent | workflow | chat | space | team | meeting | channel | identity

/** Sections that render their OWN surface instead of the shared card grid, and so
 *  bypass the collection pipeline (normalise → filter → sort → cards). They keep
 *  the section nav so switching tabs still works. */
const CUSTOM_SURFACE_SECTIONS = new Set<LibrarySection>(["tools"]);

const SECTIONS: {
	value: LibrarySection;
	label: string;
	icon: IconSvgElement;
}[] = [
	{ value: "recents", label: "Recents", icon: Clock01Icon },
	{ value: "favorites", label: "Favorites", icon: StarIcon },
	{ value: "agent", label: "Agents", icon: Target01Icon },
	{ value: "workflow", label: "Workflows", icon: WorkflowCircle06Icon },
	{ value: "chat", label: "Chats", icon: BookOpen01Icon },
	{ value: "space", label: "Spaces", icon: DeliverySecure01Icon },
	{ value: "team", label: "Teams", icon: UserGroupIcon },
	{ value: "meeting", label: "Meetings", icon: AudioWave01Icon },
	{ value: "channel", label: "Channels", icon: BubbleChatIcon },
	{ value: "identity", label: "Identities", icon: Key01Icon },
	// Tools moved here from the Store: the Store is for FINDING things to add, this
	// is for managing and invoking what is already installed.
	{ value: "tools", label: "Tools", icon: Wrench01Icon },
];

/** The app that owns each collection. A tab shows only when its owning app is
 *  enabled — so an uninstalled Workflows/Teams/Meetings app leaves no empty tab.
 *  Sections absent here (recents/favorites/chat/channel/identity) are host
 *  surfaces, always shown. */
const SECTION_PLUGIN: Partial<Record<LibrarySection, string>> = {
	agent: "@ryu/agents",
	workflow: "@ryu/workflows",
	space: "@ryu/spaces",
	team: "@ryu/teams",
	meeting: "@ryu/meetings",
};

/** Per-type display metadata for the synthetic (mixed) tabs and filter chips. */
const TYPE_META: Record<
	LibraryItemType,
	{ label: string; icon: IconSvgElement }
> = {
	agent: { label: "Agent", icon: Target01Icon },
	workflow: { label: "Workflow", icon: WorkflowCircle06Icon },
	chat: { label: "Chat", icon: BookOpen01Icon },
	space: { label: "Space", icon: DeliverySecure01Icon },
	team: { label: "Team", icon: UserGroupIcon },
	meeting: { label: "Meeting", icon: AudioWave01Icon },
	channel: { label: "Channel", icon: BubbleChatIcon },
	identity: { label: "Identity", icon: Key01Icon },
};

const SORT_OPTIONS: LibrarySortOption[] = [
	{ value: "updated", label: "Recently updated" },
	{ value: "name-asc", label: "Name A–Z" },
	{ value: "name-desc", label: "Name Z–A" },
];

/** A collection item normalised from its data hook into one shared shape. */
interface LibraryItem {
	/** Type-specific chip (status, etc.) for typed tabs. */
	badge: string | null;
	icon: IconSvgElement;
	id: string;
	name: string;
	open: () => void;
	/** Optional richer card-body preview (grid view only). Local, cheap nodes
	 * only — anything that fetches must be gated per-tab in `toCardData`. */
	preview?: ReactNode;
	subtitle: string | null;
	type: LibraryItemType;
	/** Normalised epoch-ms, for "Recently updated" sort. */
	updatedAt: number;
}

function isLibrarySection(value: string): value is LibrarySection {
	return SECTIONS.some((s) => s.value === value);
}

/** True for the sections that ARE a `LibraryItemType` — i.e. the ones backed by the
 *  shared collection pipeline. Excludes the synthetic mixed tabs and any
 *  custom-surface section (which has no `LibraryItem` representation at all, so it
 *  must never be offered as a type filter chip). */
function isItemType(value: LibrarySection): value is LibraryItemType {
	return (
		value !== "recents" &&
		value !== "favorites" &&
		!CUSTOM_SURFACE_SECTIONS.has(value)
	);
}

/**
 * Library entry point. The Memory section renders a bespoke management surface
 * (its items don't fit the shared card/grid machinery), so it's dispatched to
 * `MemoryLibrary` before the collection shell — keeping the collection hooks
 * below unconditional.
 */
export default function LibraryPage(props: { initialSection?: string }) {
	if (props.initialSection === "memory") {
		return <MemoryLibrary />;
	}
	return <LibraryCollections {...props} />;
}

function LibraryCollections({
	initialSection = "recents",
}: {
	initialSection?: string;
}) {
	const [section, setSection] = useState<LibrarySection>(
		isLibrarySection(initialSection) ? initialSection : "recents"
	);

	// View mode persists across tabs and sessions; query/sort reset per tab.
	const [view, setView] = useState<ViewMode>(() => {
		try {
			return localStorage.getItem("ryu:library-view") === "list"
				? "list"
				: "grid";
		} catch {
			return "grid";
		}
	});
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState("updated");
	// Type filter for the mixed tabs (Recents/Favorites); null = all.
	const [typeFilter, setTypeFilter] = useState<LibraryItemType | null>(null);

	// Reset the per-tab controls when switching collections.
	useEffect(() => {
		setQuery("");
		setSort("updated");
		setTypeFilter(null);
	}, []);

	const onViewChange = (mode: ViewMode) => {
		setView(mode);
		try {
			localStorage.setItem("ryu:library-view", mode);
		} catch {
			// best-effort persistence
		}
	};

	const { openTab } = useTabsContext();
	const { favorites, toggle: toggleFavorite } = useFavorites();
	const recents = useRecents();

	// Data sources.
	const { agents, engines, loading: agentsLoading } = useAgents();
	const { workflows, loading: workflowsLoading } = useWorkflows();
	const { teams, create: createTeam, update: updateTeam } = useTeams();
	const { meetings, loading: meetingsLoading } = useMeetings();
	const {
		spaces,
		loading: spacesLoading,
		create: createSpace,
	} = useSpacesContext();
	const { conversations } = useChatHistoryContext();
	const { channels, loading: channelsLoading } = useChannels();
	const { profiles, loading: identitiesLoading } = useIdentities();

	// Only show a collection tab when its owning app is enabled — an uninstalled
	// Workflows/Teams/Meetings app should leave no empty tab. Host surfaces
	// (recents/favorites/chat/channel/identity) have no owner and always show.
	const { apps, loading: appsLoading } = useApps();
	const enabledPlugins = useMemo(
		() => new Set(apps.filter((a) => a.enabled).map((a) => a.id)),
		[apps]
	);
	// While the app list is still loading, show every tab — gating on an empty set
	// would flash the default-on collections (Agents/Spaces/Teams) off then on.
	const visibleSections = useMemo(
		() =>
			appsLoading
				? SECTIONS
				: SECTIONS.filter((s) => {
						const plugin = SECTION_PLUGIN[s.value];
						return !plugin || enabledPlugins.has(plugin);
					}),
		[enabledPlugins, appsLoading]
	);

	// If the active tab's app was just disabled, fall back to Recents so the page
	// never sits on a now-hidden collection.
	useEffect(() => {
		if (!visibleSections.some((s) => s.value === section)) {
			setSection("recents");
		}
	}, [visibleSections, section]);

	// Create-dialog state for the collections that need a name before they exist.
	const [spaceDialogOpen, setSpaceDialogOpen] = useState(false);
	const [teamDialogOpen, setTeamDialogOpen] = useState(false);
	const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

	const engineLabel = useCallback(
		(engine: string | null): string | null => {
			if (!engine) {
				return null;
			}
			const match = engines.find(
				(e) => e.id === engine || e.id.endsWith(`:${engine}`)
			);
			return match?.name ?? engine;
		},
		[engines]
	);

	const openTeam = useCallback((id: string | null) => {
		setEditingTeamId(id);
		setTeamDialogOpen(true);
	}, []);

	// --- Normalise each collection into LibraryItem[] -----------------------

	const agentItems = useMemo<LibraryItem[]>(
		() =>
			agents.map((a) => ({
				type: "agent",
				id: a.id,
				name: a.name,
				subtitle: engineLabel(a.engine) ?? a.description,
				badge: a.builtIn ? "Built-in" : null,
				icon: Target01Icon,
				updatedAt: normalizeTimestamp(a.createdAt),
				// openTab stamps recents from the route; no explicit stamp needed.
				open: () => openTab(`/agents/${a.id}/edit`, { title: a.name }),
			})),
		// engines feed engineLabel; rebuild when either changes.
		[agents, engineLabel, openTab]
	);

	const workflowItems = useMemo<LibraryItem[]>(
		() =>
			workflows.map((w) => ({
				type: "workflow",
				id: w.id,
				name: w.name,
				subtitle:
					w.description ??
					`${w.nodes.length} ${w.nodes.length === 1 ? "node" : "nodes"}`,
				badge: null,
				icon: WorkflowCircle06Icon,
				updatedAt: normalizeTimestamp(w.updatedAt ?? w.createdAt),
				open: () => openTab(`/workflows/${w.id}`, { title: w.name }),
				preview: (
					<WorkflowFlowStrip
						edges={w.edges}
						nodes={w.nodes}
						triggers={w.triggers}
					/>
				),
			})),
		[workflows, openTab]
	);

	const chatItems = useMemo<LibraryItem[]>(
		() =>
			conversations.map((c) => ({
				type: "chat",
				id: c.id,
				name: c.title || "Untitled chat",
				subtitle: c.folderPath ?? null,
				badge: c.archived ? "Archived" : null,
				icon: BookOpen01Icon,
				updatedAt: normalizeTimestamp(c.updatedAt ?? c.createdAt),
				open: () => openTab("/chat", { conversationId: c.id }),
			})),
		[conversations, openTab]
	);

	const spaceItems = useMemo<LibraryItem[]>(
		() =>
			spaces
				// Hide the auto-created Meetings space (surfaced under Meetings).
				.filter((s) => s.name !== "Meetings")
				.map((s) => ({
					type: "space",
					id: s.id,
					name: s.name,
					subtitle:
						s.description ??
						`${s.documentCount} ${s.documentCount === 1 ? "doc" : "docs"}`,
					badge: null,
					icon: DeliverySecure01Icon,
					updatedAt: normalizeTimestamp(s.updatedAt ?? s.createdAt),
					open: () => {
						stampRecent("space", s.id);
						// Path segment (not a query string): openTab strips query strings,
						// so the space id must live in the route to survive.
						openTab(`/spaces/${s.id}`, { title: s.name });
					},
				})),
		[spaces, openTab]
	);

	const teamItems = useMemo<LibraryItem[]>(
		() =>
			teams.map((t) => ({
				type: "team",
				id: t.id,
				name: t.name,
				subtitle:
					t.description ??
					`${t.members.length} ${t.members.length === 1 ? "member" : "members"}`,
				badge: null,
				icon: UserGroupIcon,
				updatedAt: normalizeTimestamp(t.updatedAt ?? t.createdAt),
				open: () => {
					stampRecent("team", t.id);
					openTeam(t.id);
				},
			})),
		[teams, openTeam]
	);

	const meetingItems = useMemo<LibraryItem[]>(
		() =>
			meetings.map((m) => ({
				type: "meeting",
				id: m.id,
				name: m.title,
				subtitle: m.status === "recording" ? "Recording…" : null,
				badge: m.status === "recording" ? "Live" : null,
				icon: AudioWave01Icon,
				updatedAt: normalizeTimestamp(m.updated_at ?? m.created_at),
				open: () => openTab(`/meetings/${m.id}`, { title: m.title }),
			})),
		[meetings, openTab]
	);

	const channelItems = useMemo<LibraryItem[]>(
		() =>
			channels.map((c) => ({
				type: "channel",
				id: c.id,
				name: c.name,
				subtitle: CHANNEL_LABELS[c.channelType],
				badge: c.enabled ? null : "Disabled",
				icon: BubbleChatIcon,
				updatedAt: normalizeTimestamp(c.updatedAt ?? c.createdAt),
				open: () => openTab(`/channels/${c.id}`, { title: c.name }),
			})),
		[channels, openTab]
	);

	const identityItems = useMemo<LibraryItem[]>(
		() =>
			profiles.map((p) => {
				const count = p.connections.length;
				const authenticated = p.connections.filter(
					(c) => c.status === "AUTHENTICATED"
				).length;
				const latest = p.connections.reduce(
					(max, c) => Math.max(max, c.updated_at ?? c.created_at ?? 0),
					0
				);
				return {
					type: "identity" as const,
					id: p.profile_id,
					name: p.profile_id,
					subtitle: `${count} ${count === 1 ? "connection" : "connections"}`,
					badge: count > 0 ? `${authenticated}/${count} signed in` : null,
					icon: Key01Icon,
					updatedAt: normalizeTimestamp(latest),
					open: () => {
						stampRecent("identity", p.profile_id);
						openTab(`/identities/profile/${encodeURIComponent(p.profile_id)}`, {
							title: p.profile_id,
						});
					},
				};
			}),
		[profiles, openTab]
	);

	const itemsByType = useMemo<Record<LibraryItemType, LibraryItem[]>>(
		() => ({
			agent: agentItems,
			workflow: workflowItems,
			chat: chatItems,
			space: spaceItems,
			team: teamItems,
			meeting: meetingItems,
			channel: channelItems,
			identity: identityItems,
		}),
		[
			agentItems,
			workflowItems,
			chatItems,
			spaceItems,
			teamItems,
			meetingItems,
			channelItems,
			identityItems,
		]
	);

	// Flat lookup for resolving recents/favorites refs.
	const itemByKey = useMemo(() => {
		const map = new Map<string, LibraryItem>();
		for (const list of Object.values(itemsByType)) {
			for (const item of list) {
				map.set(refKey(item.type, item.id), item);
			}
		}
		return map;
	}, [itemsByType]);

	// Resolve the synthetic tabs, dropping refs whose item no longer resolves.
	const recentItems = useMemo<LibraryItem[]>(
		() =>
			recents
				.map((r) => itemByKey.get(refKey(r.type, r.id)))
				.filter((i): i is LibraryItem => i !== undefined),
		[recents, itemByKey]
	);

	const favoriteItems = useMemo<LibraryItem[]>(
		() =>
			favorites
				.map((f) => itemByKey.get(refKey(f.type, f.id)))
				.filter((i): i is LibraryItem => i !== undefined),
		[favorites, itemByKey]
	);

	const loadingByType: Record<LibraryItemType, boolean> = {
		agent: agentsLoading,
		workflow: workflowsLoading,
		chat: false,
		space: spacesLoading,
		team: false,
		meeting: meetingsLoading,
		channel: channelsLoading,
		identity: identitiesLoading,
	};

	// --- Build the visible list for the active tab --------------------------

	const isMixed = section === "recents" || section === "favorites";
	let baseItems: LibraryItem[];
	if (section === "recents") {
		baseItems = recentItems;
	} else if (section === "favorites") {
		baseItems = favoriteItems;
	} else if (isItemType(section)) {
		baseItems = itemsByType[section];
	} else {
		// A custom-surface section (Tools) has no LibraryItem representation — it
		// renders its own surface and never reaches the card grid, so the collection
		// pipeline below runs over an empty list rather than being skipped (keeping
		// every hook below unconditional).
		baseItems = [];
	}

	// Recents/Favorites resolve refs across every collection, so on launch (the
	// default tab is Recents) they must show a loading state while any source is
	// still loading and nothing has resolved yet — otherwise they'd flash the
	// "nothing here" empty state before the data arrives.
	const anySourceLoading =
		agentsLoading ||
		workflowsLoading ||
		spacesLoading ||
		meetingsLoading ||
		channelsLoading ||
		identitiesLoading;
	const loading = isMixed
		? anySourceLoading && baseItems.length === 0
		: // A custom-surface section owns its own loading state.
			isItemType(section) && loadingByType[section];

	const visibleItems = useMemo(() => {
		let list = baseItems;
		if (isMixed && typeFilter) {
			list = list.filter((i) => i.type === typeFilter);
		}
		const q = query.trim().toLowerCase();
		if (q) {
			list = list.filter(
				(i) =>
					i.name.toLowerCase().includes(q) ||
					(i.subtitle?.toLowerCase().includes(q) ?? false)
			);
		}
		// Recents keep their intrinsic (most-recent-first) order; the typed and
		// favorites tabs honour the sort control.
		if (section === "recents") {
			return list;
		}
		const sorted = [...list];
		if (sort === "name-asc") {
			sorted.sort((a, b) => a.name.localeCompare(b.name));
		} else if (sort === "name-desc") {
			sorted.sort((a, b) => b.name.localeCompare(a.name));
		} else {
			sorted.sort((a, b) => b.updatedAt - a.updatedAt);
		}
		return sorted;
	}, [baseItems, isMixed, typeFilter, query, sort, section]);

	// Which types actually appear in a mixed tab, so we only offer real chips.
	const presentTypes = useMemo(() => {
		const set = new Set<LibraryItemType>();
		for (const i of baseItems) {
			set.add(i.type);
		}
		return set;
	}, [baseItems]);

	// --- Per-tab CTA --------------------------------------------------------

	const handleNewChat = () => openTab("/chat", { forceNew: true });

	const ctaForSection = (): {
		label: string;
		onCta: () => void;
	} | null => {
		switch (section) {
			case "recents":
			case "chat":
				return { label: "New chat", onCta: handleNewChat };
			case "agent":
				return {
					label: "New agent",
					onCta: () => openTab("/agents/new/edit", { title: "New agent" }),
				};
			case "workflow":
				return {
					label: "New workflow",
					onCta: () => openTab("/workflows/new", { title: "New workflow" }),
				};
			case "space":
				return { label: "New space", onCta: () => setSpaceDialogOpen(true) };
			case "team":
				return { label: "New team", onCta: () => openTeam(null) };
			case "meeting":
				return {
					label: "Record a meeting",
					onCta: () => openTab("/meetings", { title: "Meetings" }),
				};
			case "channel":
				return {
					label: "New channel",
					onCta: () => openTab("/channels/new", { title: "New channel" }),
				};
			case "identity":
				return {
					label: "New identity",
					onCta: () => openTab("/identities/new", { title: "New identity" }),
				};
			default:
				// Favorites has no create affordance — you favorite existing items.
				return null;
		}
	};
	const cta = ctaForSection();

	// On the mixed tabs, prefix each card with its type so kinds are legible.
	const toCardData = (item: LibraryItem): LibraryCardData => {
		// Previews are grid-only (list rows stay compact). The space preview
		// fetches, so it is mounted ONLY on the dedicated Spaces tab — never on the
		// mixed Recents/Favorites tabs that land on launch. The workflow strip is
		// local data, so it renders wherever a workflow card appears.
		let preview: ReactNode;
		if (view === "grid") {
			if (item.type === "space" && section === "space") {
				const space = spaces.find((s) => s.id === item.id);
				preview = (
					<SpacePreview
						documentCount={space?.documentCount ?? 0}
						spaceId={item.id}
					/>
				);
			} else {
				preview = item.preview;
			}
		}
		return {
			key: refKey(item.type, item.id),
			icon: item.icon,
			name: item.name,
			subtitle: item.subtitle,
			badge: isMixed ? TYPE_META[item.type].label : item.badge,
			favorited: favorites.some(
				(f) => f.type === item.type && f.id === item.id
			),
			preview,
		};
	};

	const sectionMeta = SECTIONS.find((s) => s.value === section);

	const emptyCopy: Record<LibrarySection, string> = {
		recents: "Items you open will show up here.",
		favorites:
			"Star an agent, workflow, chat, or anything else to pin it here.",
		agent: "Create your first agent to get started.",
		workflow: "Build an automation on the workflow canvas.",
		chat: "Start a new chat to see it here.",
		space: "Create a space to give your agents a knowledge base.",
		team: "Group several agents into a team.",
		meeting: "Record a meeting to get AI-written notes.",
		channel: "Connect a Telegram, Slack, WhatsApp, or Discord bot.",
		identity: "Save a login profile agents can reuse on the web.",
		// Never rendered — the Tools tab owns its own empty states — but the record is
		// exhaustive over LibrarySection so a new tab cannot be added without deciding
		// what its empty state says.
		tools: "Add an MCP server to give your agents new tools.",
	};

	const editingTeam = teams.find((t) => t.id === editingTeamId) ?? null;
	const handleTeamSubmit = async (draft: TeamDraft) => {
		if (editingTeam) {
			await updateTeam(editingTeam.id, draft);
		} else {
			await createTeam(draft);
		}
	};

	// A custom-surface section (Tools) brings its own search, filters and empty
	// states, so the shell's search box and collection toolbar are omitted rather
	// than rendered dead beside them — two search fields on one screen is the exact
	// kind of duplication that made this area feel bolted together.
	const customSurface = CUSTOM_SURFACE_SECTIONS.has(section);

	return (
		<div className="relative flex h-full flex-col overflow-hidden">
			<StoreSectionNav
				active={section}
				onSelect={(value: string) => {
					if (isLibrarySection(value)) {
						setSection(value);
					}
				}}
				panel={
					customSurface ? undefined : (
						<LibraryToolbar
							ctaIcon={cta ? Add01Icon : undefined}
							ctaLabel={cta?.label}
							filterSlot={
								isMixed ? (
									<div className="flex items-center gap-0.5">
										<LibraryFilterChip
											active={typeFilter === null}
											label="All"
											onClick={() => setTypeFilter(null)}
										/>
										{SECTIONS.filter(
											(
												s
											): s is {
												value: LibraryItemType;
												label: string;
												icon: IconSvgElement;
											} => isItemType(s.value) && presentTypes.has(s.value)
										).map((s) => (
											<LibraryFilterChip
												active={typeFilter === s.value}
												icon={TYPE_META[s.value].icon}
												key={s.value}
												label={s.label}
												onClick={() => setTypeFilter(s.value)}
											/>
										))}
									</div>
								) : undefined
							}
							onCta={cta?.onCta}
							onSortChange={setSort}
							onViewChange={onViewChange}
							showSearch={false}
							sort={section === "recents" ? undefined : sort}
							sortOptions={section === "recents" ? [] : SORT_OPTIONS}
							view={view}
						/>
					)
				}
				search={
					customSurface
						? undefined
						: {
								value: query,
								onChange: setQuery,
								placeholder: `Search ${sectionMeta?.label.toLowerCase() ?? "items"}…`,
							}
				}
				sections={visibleSections}
			/>

			{/* A custom-surface section fills the shell itself: it is a full-height
			    master/detail layout with its own scroll containers, so it must NOT be
			    nested inside the centered, scrolling card column below. `pt-12` still
			    clears the transparent titlebar. */}
			{customSurface ? (
				<div className="min-h-0 flex-1 overflow-hidden pt-12">
					{section === "tools" ? <ToolsLibrary /> : null}
				</div>
			) : (
				/* Single scroll viewport → content scrolls UNDER the frosted, transparent
			    titlebar (Layout no longer reserves its height for /library — see
			    pathScrollsUnderTitlebar). `pt-12` clears the bar. */
				/* Centered, capped-width column mirroring the Store/Customize catalog
			    layout — the cards read as the same 2-column grid rather than a
			    full-bleed wall. */
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-12 pb-24">
					<div className="mx-auto w-full max-w-4xl">
						{loading ? (
							<LibraryLoading />
						) : visibleItems.length === 0 ? (
							<LibraryEmpty
								description={
									query ? "Nothing matches your search." : emptyCopy[section]
								}
								icon={sectionMeta?.icon ?? LibraryIcon}
								title={
									query
										? "No results"
										: `No ${sectionMeta?.label.toLowerCase() ?? "items"} yet`
								}
							/>
						) : (
							<LibraryGrid columns={2} view={view}>
								{visibleItems.map((item) => (
									<LibraryCard
										item={toCardData(item)}
										key={refKey(item.type, item.id)}
										onOpen={item.open}
										onToggleFavorite={() => toggleFavorite(item.type, item.id)}
										view={view}
									/>
								))}
							</LibraryGrid>
						)}
					</div>
				</div>
			)}

			<CreateSpaceDialog
				onClose={() => setSpaceDialogOpen(false)}
				onCreate={createSpace}
				open={spaceDialogOpen}
			/>
			<TeamDialog
				agents={agents}
				onClose={() => setTeamDialogOpen(false)}
				onSubmit={handleTeamSubmit}
				open={teamDialogOpen}
				team={editingTeam}
			/>
		</div>
	);
}
