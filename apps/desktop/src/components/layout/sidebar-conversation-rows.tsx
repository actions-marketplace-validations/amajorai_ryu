// Conversation rows for the desktop sidebar.
//
// AppSidebar owns the conversation state and callbacks. This module owns only
// the row-level rendering and local disclosure state, so group/list composition
// can remain with the sidebar section that supplies it.

import {
	Archive01Icon,
	ArchiveRestoreIcon,
	ArrowDown01Icon,
	ArrowUpRight01Icon,
	ClipboardIcon,
	Delete01Icon,
	GitBranchIcon,
	ImageAdd01Icon,
	Mail01Icon,
	MessageQuestionIcon,
	MoreHorizontalIcon,
	PencilEdit01Icon,
	PinIcon,
	PinOffIcon,
	UserMultiple02Icon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useChatDisplayPrefs } from "@ryu/blocks/desktop/agent-elements/chat-display-prefs.tsx";
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
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import type { GlyphValue } from "@ryu/ui/components/glyph.ts";
import { GlyphDisplay } from "@ryu/ui/components/glyph-display.tsx";
import { Icon } from "@ryu/ui/components/icon.tsx";
import { SidebarMenu, SidebarMenuItem } from "@ryu/ui/components/sidebar.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { formatCount } from "@ryu/ui/lib/number-format.ts";
import {
	type DragEvent as ReactDragEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	GitPullRequestStatusIcon,
	GitPullRequestSummary,
} from "@/src/components/panels/GitPullRequestSummary.tsx";
import { useGitPullRequest } from "@/src/hooks/useGitPullRequest.ts";
import { useInterfaceLevel } from "@/src/hooks/useInterfaceLevel.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { useSidebarChatPreview } from "@/src/hooks/useSidebarChatPreview.ts";
import {
	conversationParticipantIds,
	isForkedConversation,
	isGroupConversation,
} from "@/src/lib/agent-conversation-groups.ts";
import { AgentAvatar, engineForAgent } from "@/src/lib/agent-logos.tsx";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import type { BtwEntry } from "@/src/lib/api/btw.ts";
import { listBtw } from "@/src/lib/api/btw.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	getConversationTitleHistory,
	type TitleHistoryEntry,
} from "@/src/lib/api/conversation-flags.ts";
import {
	getConversationLearningExclusion,
	setConversationLearningExclusion,
} from "@/src/lib/api/learn.ts";
import {
	type PluginContextMenuItem,
	pluginHostInvoke,
} from "@/src/lib/api/plugins.ts";
import { conversationRunStatusMeta } from "@/src/lib/conversation-run-status.ts";
import { copyChatTranscript } from "@/src/lib/copy-chat-transcript.ts";
import {
	RESOURCE_VISIBILITY_DND_MIME,
	type ResourceVisibility,
	resourceVisibilityDndMime,
	resourceVisibilityGroup,
	serializeVisibilityDragPayload,
	type VisibilityChangeRequest,
} from "@/src/lib/resource-visibility.ts";
import { buildSidebarConversationPreviewStates } from "@/src/lib/sidebar-conversation-preview.ts";
import { compactAge } from "@/src/lib/time.ts";
import type { Conversation, Message } from "@/types/chat.ts";
import { EntityIconDialog } from "./EntityIconDialog.tsx";
import { FadeLabel, OverflowTooltip } from "./overflow-tooltip.tsx";
import { ResourceVisibilityIndicator } from "./ResourceVisibilityIndicator.tsx";
import {
	ChatRowSubAccordion,
	SidebarChatMessages,
} from "./sidebar-chat-messages.tsx";
import { SidebarConversationPreview } from "./sidebar-conversation-preview.tsx";
import {
	SidebarItemPreview,
	SidebarPreviewMeta,
	SidebarPreviewTitle,
	SidebarPreviewTitleHistory,
} from "./sidebar-item-preview.tsx";

const PATH_SEP_RE = /[\\/]/;

export interface ChatRowHandlers {
	activeConversationId: string | null;
	agents: AgentSummary[];
	archivedIds: Set<string>;
	/** UI courtesy; Core remains the authority for this admin-only transition. */
	canMakePrivate: boolean;
	loadMessages: (id: string) => Promise<Message[]>;
	onDeleteConversation: (id: string) => void;
	onJumpToMessage: (conversationId: string, messageId: string) => void;
	onMarkRead: (id: string) => void;
	onMarkUnread: (id: string) => void;
	onOpenInNewTab: (id: string) => void;
	/** Open a persisted side chat: select the thread + surface it in the overlay. */
	onOpenSideChat: (conversationId: string, entry: BtwEntry) => void;
	onRenameConversation: (id: string, title: string) => void;
	/** Open the confirmation flow for an owner-only/team visibility change. */
	onRequestConversationVisibility: (request: VisibilityChangeRequest) => void;
	onSelectConversation: (id: string) => void;
	/** Set or clear a conversation's Notion-style glyph. */
	onSetConversationIcon: (id: string, icon: GlyphValue) => void;
	onToggleArchive: (id: string) => void;
	onTogglePin: (id: string) => void;
	pinnedIds: Set<string>;
	/** Whether the app-owned GitHub provider can answer PR/check lookups. */
	pullRequestsEnabled?: boolean;
	/** Whether the Side Chats plugin owns the nested side-chat affordance. */
	sideChatsEnabled?: boolean;
	/** Node target for lazily listing a conversation's side chats. */
	target: ApiTarget;
	unreadIds: Set<string>;
}

/** Lazily-loaded list of a conversation's persisted `/btw` side chats, shown
 *  indented under its row. Only mounted when the row is expanded, so collapsed
 *  rows never hit Core. Reads the node target through a ref so the fresh
 *  `toTarget()` object identity each render doesn't retrigger the fetch (see the
 *  desktop target-object deps gotcha). */
export function SidebarSideChats({
	conversationId,
	target,
	onOpen,
}: {
	conversationId: string;
	onOpen: (entry: BtwEntry) => void;
	target: ApiTarget;
}) {
	const [entries, setEntries] = useState<BtwEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const targetRef = useRef(target);
	targetRef.current = target;

	useEffect(() => {
		const controller = new AbortController();
		listBtw(targetRef.current, conversationId, controller.signal)
			.then((list) => {
				if (!controller.signal.aborted) {
					setEntries(list);
				}
			})
			.catch(() => {
				/* treated as no side chats */
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			});
		return () => controller.abort();
	}, [conversationId]);

	if (loading) {
		return <p className="py-1 pl-8 text-muted-foreground text-xs">Loading…</p>;
	}
	if (entries.length === 0) {
		return (
			<p className="py-1 pl-8 text-muted-foreground text-xs">No side chats</p>
		);
	}
	return (
		<div className="relative ml-2 border-sidebar-border/70 border-l pl-2">
			<SidebarMenu className="gap-0.5">
				{entries.map((entry) => {
					const answerPreview = entry.answer.split(/\r?\n/)[0]?.trim() ?? "";
					const kindLabel =
						entry.kind === "subagent" ? "Subagent" : "Side chat";
					return (
						<SidebarMenuItem key={entry.id}>
							<button
								aria-label={`Open ${kindLabel.toLowerCase()}: ${entry.question}`}
								className="group relative flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
								onClick={() => onOpen(entry)}
								type="button"
							>
								<span
									aria-hidden="true"
									className="absolute top-3 -left-[5px] size-2 rounded-full bg-primary ring-2 ring-sidebar"
								/>
								<HugeiconsIcon
									className="mt-0.5 size-3.5 shrink-0 text-primary/75"
									icon={MessageQuestionIcon}
								/>
								<span className="min-w-0 flex-1">
									<span className="flex min-w-0 items-center gap-1.5">
										<OverflowTooltip
											className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-medium text-foreground/85 text-xs"
											fade
											text={entry.question}
										/>
										<span className="shrink-0 text-[10px] text-muted-foreground/60">
											{compactAge(entry.created_at)}
										</span>
									</span>
									<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/65">
										<span className="shrink-0">{kindLabel}</span>
										{answerPreview && (
											<OverflowTooltip
												className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
												fade
												text={answerPreview}
											/>
										)}
									</span>
								</span>
							</button>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</div>
	);
}

/** Lazily loads title history for the chat-row hover preview. */
function ChatTitleHistoryPreview({
	conversationId,
	target,
}: {
	conversationId: string;
	target: ApiTarget;
}) {
	const [entries, setEntries] = useState<TitleHistoryEntry[]>([]);
	const targetRef = useRef(target);
	targetRef.current = target;

	useEffect(() => {
		let cancelled = false;
		getConversationTitleHistory(targetRef.current, conversationId).then(
			(rows) => {
				if (!cancelled) {
					setEntries(rows);
				}
			}
		);
		return () => {
			cancelled = true;
		};
	}, [conversationId]);

	return <SidebarPreviewTitleHistory entries={entries} />;
}

/** App-owned PR/CI metadata for a chat's hover card. The child is mounted only
 * when the preview opens, so a long sidebar does not wake the Pull Requests
 * sidecar for every row. */
function SidebarGitPullRequestPreview({
	branch,
	cwd,
	showStatusIcon,
	target,
}: {
	branch: string;
	cwd: string;
	showStatusIcon: boolean;
	target: ApiTarget;
}) {
	const { data, isLoading } = useGitPullRequest(
		target,
		cwd,
		branch,
		true,
		"all"
	);
	if (isLoading) {
		return (
			<div className="border-border/60 border-t pt-2 text-muted-foreground text-xs">
				Checking GitHub…
			</div>
		);
	}
	if (!data) {
		return null;
	}
	return (
		<div className="border-border/60 border-t pt-2">
			<GitPullRequestSummary
				pullRequest={data}
				showStatusIcon={showStatusIcon}
			/>
		</div>
	);
}

function SidebarGitPullRequestStatus({
	branch,
	cwd,
	target,
}: {
	branch: string;
	cwd: string;
	target: ApiTarget;
}) {
	const { data } = useGitPullRequest(target, cwd, branch, true, "all");
	if (!data) {
		return null;
	}
	return (
		<a
			aria-label={`Open pull request: ${data.title}`}
			className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			href={data.url}
			onClick={(event) => event.stopPropagation()}
			rel="noopener noreferrer"
			target="_blank"
		>
			<GitPullRequestStatusIcon pullRequest={data} />
		</a>
	);
}

/** Small orbit of participant avatars for a multi-agent conversation. The
 *  four-point layout stays legible at the 16px disclosure size and makes a
 *  council/team thread read as a group before its title is read. */
export function ParticipantOrbitAvatar({
	participants,
	agents,
	size = "sm",
}: {
	agents: AgentSummary[];
	participants: string[];
	size?: "md" | "sm";
}) {
	const large = size === "md";
	const members = participants
		.map((id) => agents.find((agent) => agent.id === id))
		.filter((agent): agent is AgentSummary => Boolean(agent));
	if (members.length === 0) {
		return (
			<HugeiconsIcon
				aria-label={`${participants.length} participants`}
				className={
					large
						? "size-8 text-muted-foreground"
						: "size-4 text-muted-foreground"
				}
				icon={UserMultiple02Icon}
			/>
		);
	}
	const shown = members.slice(0, 4);
	const positions =
		shown.length === 2
			? ["left-0 top-1/2 -translate-y-1/2", "right-0 top-1/2 -translate-y-1/2"]
			: shown.length === 3
				? [
						"left-1/2 top-0 -translate-x-1/2",
						"bottom-0 right-0",
						"bottom-0 left-0",
					]
				: [
						"left-1/2 top-0 -translate-x-1/2",
						"right-0 top-1/2 -translate-y-1/2",
						"bottom-0 left-1/2 -translate-x-1/2",
						"left-0 top-1/2 -translate-y-1/2",
					];
	return (
		<span
			aria-label={`${participants.length} participants`}
			className={`relative flex shrink-0 ${large ? "size-9" : "size-4"}`}
			title={`${participants.length} participants`}
		>
			{shown.map((agent, index) => (
				<span
					className={`absolute flex items-center justify-center overflow-hidden rounded-full bg-sidebar ring-1 ring-sidebar ${large ? "size-5 ring-2" : "size-2.5"} ${positions[index]}`}
					key={agent.id}
					style={{ zIndex: shown.length - index }}
				>
					<AgentAvatar
						className={`${large ? "size-5" : "size-2.5"} rounded-full object-cover`}
						engine={engineForAgent(agent)}
						glyph={agent.avatarGlyph}
						size={large ? "20px" : "10px"}
					/>
				</span>
			))}
		</span>
	);
}

/** A single-line chat row, Codex style: title only, actions on hover.
 *
 *  Exported for `e2e/harness/chat-row-menus-story.tsx`, which mounts the real row
 *  to prove its ⋯ dropdown and its right-click menu list the SAME app-contributed
 *  rows — a fact no type-check can see, and one the two menus had already lost. */
export function ChatRow({
	conv,
	handlers,
}: {
	conv: Conversation;
	handlers: ChatRowHandlers;
}) {
	const {
		activeConversationId,
		agents,
		archivedIds,
		pinnedIds,
		unreadIds,
		loadMessages,
		onDeleteConversation,
		onJumpToMessage,
		onMarkRead,
		onMarkUnread,
		onOpenInNewTab,
		onOpenSideChat,
		onRenameConversation,
		onSelectConversation,
		onSetConversationIcon,
		onToggleArchive,
		onTogglePin,
		pullRequestsEnabled = false,
		target,
		sideChatsEnabled = true,
	} = handlers;
	const isActive = activeConversationId === conv.id;
	const isUnread = unreadIds.has(conv.id);
	const isPinned = pinnedIds.has(conv.id);
	const isArchived = archivedIds.has(conv.id);
	const runStatus = conversationRunStatusMeta(conv.runStatus);
	const [showSidebarChatPreview] = useSidebarChatPreview();
	const interfaceLevel = useInterfaceLevel();
	const { animationsEnabled } = useChatDisplayPrefs();
	const sidebarPreviewStates = buildSidebarConversationPreviewStates({
		lastMessage: conv.lastMessage,
		lastMessageRole: conv.lastMessageRole,
		statusLabel: runStatus?.label,
		statusVisible: runStatus?.isRunning || runStatus?.needsAttention,
	});
	// A state that cannot make progress without attention badges itself even when
	// the chat is read. In particular, interrupted is not failed: it is a partial
	// reply Core recovered after the local engine stopped, and it cannot auto-resume.
	const showDot = isUnread || runStatus?.needsAttention === true;
	const isRunning = runStatus?.isRunning === true;
	// Who last took this thread. The row leads with that agent's mark — the same
	// avatar the Messages sub-accordion puts on each turn — so a sidebar full of
	// chats says WHO is on each one before it says anything else.
	//
	// A council thread (more than one participant) reads its LAST entry: Core
	// appends on join and never sorts (`add_participant`), so that is the most
	// recent joiner. Anything else prefers `agentId`, which tracks the agent the
	// chat is bound to NOW — on a thread whose agent was swapped, a one-entry
	// participants list still holds the original.
	const participants = conv.participants ?? [];
	const groupConversation = isGroupConversation(conv);
	const latestAgentId =
		participants.length > 1
			? participants.at(-1)
			: (conv.agentId ?? participants[0] ?? null);
	const latestAgent = latestAgentId
		? agents.find((a) => a.id === latestAgentId)
		: undefined;
	// Ring colour matches the surface the badge sits ON, which is the sidebar at
	// rest and `muted` once the row is hovered or active — a fixed sidebar-coloured
	// ring would read as a mis-tinted halo on exactly the row being pointed at.
	const dotRingClass = isActive
		? "ring-2 ring-muted"
		: "ring-2 ring-sidebar group-hover/row:ring-muted";

	const pinLabel = isPinned ? "Unpin" : "Pin";
	const pinIcon = isPinned ? PinOffIcon : PinIcon;
	const archiveLabel = isArchived ? "Unarchive" : "Archive";
	const archiveIcon = isArchived ? ArchiveRestoreIcon : Archive01Icon;
	const readLabel = isUnread ? "Mark as read" : "Mark as unread";
	const shared = resourceVisibilityGroup(conv.visibility) === "team";
	const visibilityActionLabel = shared ? "Make private" : "Share with team";
	const nextVisibility: ResourceVisibility = shared ? "private" : "org";
	const visibilityGroup = shared ? "team" : "private";
	const handleVisibilityDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
		event.dataTransfer.effectAllowed = "move";
		const payload = serializeVisibilityDragPayload({
			from: visibilityGroup,
			id: conv.id,
			name: conv.title,
			resourceType: "chat",
		});
		event.dataTransfer.setData(RESOURCE_VISIBILITY_DND_MIME, payload);
		event.dataTransfer.setData(resourceVisibilityDndMime("chat"), "1");
		event.dataTransfer.setData("text/plain", payload);
	};
	const [learningExcluded, setLearningExcluded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		getConversationLearningExclusion(target, conv.id)
			.then(({ excluded }) => {
				if (!cancelled) {
					setLearningExcluded(excluded);
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [conv.id, target.token, target.url]);

	const toggleLearningExclusion = useCallback(() => {
		const next = !learningExcluded;
		setLearningExcluded(next);
		setConversationLearningExclusion(target, conv.id, next).catch(() => {
			setLearningExcluded(!next);
			toast.error("Couldn't update this chat's learning privacy", {
				description: "Check your connection and try again.",
			});
		});
	}, [conv.id, learningExcluded, target.token, target.url]);
	const learningLabel = learningExcluded
		? "Include in learning"
		: "Exclude from learning";

	// App-registered conversation-menu rows from the contributions feed, filtered
	// to the `conversation` anchor. The "Make a skill from this chat" row is a
	// Learning contribution, not a hardcoded menu item — disabling the app removes
	// the row. Each row dispatches its declared capability through the owning
	// plugin's granted host seam (`pluginHostInvoke`), never inline code.
	const { context_menu_items } = usePluginContributions();
	const contributedMenuRows = useMemo(
		() =>
			context_menu_items
				.filter((item) => item.anchor === "conversation")
				.sort(
					(a, b) =>
						(a.order ?? Number.MAX_SAFE_INTEGER) -
						(b.order ?? Number.MAX_SAFE_INTEGER)
				),
		[context_menu_items]
	);

	// One dispatcher, both surfaces. The ⋯ dropdown and the right-click menu are
	// separate primitives (`DropdownMenuItem` vs `ContextMenuItem`, so the rendered
	// rows genuinely cannot be shared), but the *action* must be defined once —
	// they had already drifted, with the right-click menu shipping no contributed
	// rows at all.
	const runContributedRow = useCallback(
		(item: PluginContextMenuItem) => {
			const feedback = item.feedback;
			const run = () =>
				pluginHostInvoke(target, item.plugin, item.capability ?? "", {
					...item.args,
					conversation_id: conv.id,
				});
			// `success` is passed unconditionally. That collapses what used to be two
			// branches here without changing behavior: `toastPromise` already falls
			// back to `loading` when `success` is omitted (`sileo.tsx`), so the
			// no-feedback case resolved to this exact label before too.
			toast.promise(run(), {
				loading: feedback?.loading ?? item.label,
				success: feedback?.success ?? item.label,
				error: feedback?.error ?? `${item.label} failed`,
			});
		},
		[conv.id, target]
	);

	// Inline rename: when `isEditing`, the title is replaced by a text input.
	// Commit on Enter / blur, cancel on Escape. Seeded from the current title.
	const [isEditing, setIsEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(conv.title);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Row disclosure expands nested Messages + Side chats sub-accordions.
	const [rowExpanded, setRowExpanded] = useState(false);
	const [messagesExpanded, setMessagesExpanded] = useState(true);
	const [sideChatsExpanded, setSideChatsExpanded] = useState(false);

	// Deleting a chat is permanent, so both the dropdown and context-menu Delete
	// actions open a confirmation dialog rather than wiping the thread outright.
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [iconDialogOpen, setIconDialogOpen] = useState(false);

	const startEditing = () => {
		setDraftTitle(conv.title);
		setIsEditing(true);
	};
	const commitEditing = () => {
		if (!isEditing) {
			return;
		}
		setIsEditing(false);
		const next = draftTitle.trim();
		if (next && next !== conv.title) {
			onRenameConversation(conv.id, next);
		}
	};
	const cancelEditing = () => setIsEditing(false);

	useEffect(() => {
		if (isEditing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [isEditing]);

	// The FULL folder path, not its leaf. The leaf is the project name the row is
	// already filed under, so it carried no information at all; the path is the
	// only place the user can see which of two same-named folders a chat belongs
	// to (and the only way to tell an imported thread's folder from a native one).
	const folderPath = conv.folderPath || null;
	const codeSession = Boolean(folderPath && conv.branch);
	const worktreeLeaf = conv.worktreePath
		? (conv.worktreePath.split(PATH_SEP_RE).pop() ?? conv.worktreePath)
		: null;
	const previewContent = (
		<SidebarPreviewTitle title={conv.title}>
			{conv.branch ? (
				<SidebarPreviewMeta label="Branch" value={conv.branch} />
			) : null}
			{folderPath ? (
				<SidebarPreviewMeta label="Folder" value={folderPath} wrap />
			) : null}
			{worktreeLeaf ? (
				<SidebarPreviewMeta label="Worktree" value={worktreeLeaf} />
			) : null}
			{typeof conv.messageCount === "number" ? (
				<SidebarPreviewMeta
					label="Messages"
					value={formatCount(conv.messageCount) ?? "0"}
				/>
			) : null}
			{(conv.participants?.length || conv.agentId) && (
				// `items-center`, not `items-baseline`: the value column holds avatars,
				// and a baseline box aligns the text's baseline while the 14px image sits
				// on it — which reads as the logo hanging below its own name.
				<div className="flex min-w-0 items-center gap-2 text-xs">
					<span className="shrink-0 text-muted-foreground">Agents</span>
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						{(conv.participants ?? (conv.agentId ? [conv.agentId] : [])).map(
							(id) => {
								const agent = agents.find((a) => a.id === id);
								return (
									<span className="flex items-center gap-1" key={id}>
										<AgentAvatar
											className="size-3.5 shrink-0 rounded-[2px] object-contain"
											engine={engineForAgent({
												id,
												engine: agent?.engine ?? null,
												builtIn: null,
											})}
											glyph={agent?.avatarGlyph}
											size="14px"
										/>
										<span className="truncate text-foreground/90">
											{agent?.name ?? id.split("/").pop() ?? id}
										</span>
									</span>
								);
							}
						)}
					</span>
				</div>
			)}
			{conv.runStatus ? (
				<SidebarPreviewMeta
					label="Status"
					value={runStatus?.label ?? conv.runStatus}
				/>
			) : null}
			<ChatTitleHistoryPreview conversationId={conv.id} target={target} />
		</SidebarPreviewTitle>
	);

	return (
		<SidebarMenuItem>
			<ContextMenu>
				<ContextMenuTrigger>
					{/* biome-ignore lint/a11y/useSemanticElements: sidebar row combines nested controls with drag/middle-click */}
					<div
						className={`group/row flex cursor-grab items-center gap-2 rounded-md px-2 transition-colors hover:bg-muted active:cursor-grabbing ${showSidebarChatPreview ? "min-h-11 py-1" : "h-8"} ${isActive ? "bg-muted" : ""}`}
						draggable
						onAuxClick={(e) => {
							// Middle-click opens the chat in a new tab.
							if (e.button === 1) {
								e.preventDefault();
								onOpenInNewTab(conv.id);
							}
						}}
						onClick={() => onSelectConversation(conv.id)}
						onDragStart={handleVisibilityDragStart}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								onSelectConversation(conv.id);
							}
						}}
						role="button"
						tabIndex={0}
					>
						<button
							aria-label={
								rowExpanded ? "Collapse chat details" : "Expand chat details"
							}
							className="relative flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
							onClick={(e) => {
								e.stopPropagation();
								setRowExpanded((v) => !v);
							}}
							type="button"
						>
							{/* The agent that last took this thread, in the same slot the
							    chevron lives in: shown at rest, crossfading out on hover (and
							    hidden while expanded) so the disclosure affordance can morph
							    in exactly as it did when this slot held only a dot. */}
							{groupConversation ? (
								<span
									className={`absolute inset-0 flex items-center justify-center transition-opacity ${
										rowExpanded
											? "opacity-0"
											: "opacity-100 group-hover/row:opacity-0"
									}`}
								>
									<ParticipantOrbitAvatar
										agents={agents}
										participants={conversationParticipantIds(conv)}
									/>
								</span>
							) : latestAgent ? (
								<AgentAvatar
									className={`absolute inset-0 m-auto size-4 rounded-[3px] object-contain transition-opacity ${
										rowExpanded
											? "opacity-0"
											: "opacity-100 group-hover/row:opacity-0"
									}`}
									engine={engineForAgent(latestAgent)}
									glyph={latestAgent.avatarGlyph}
									size="16px"
								/>
							) : null}
							{/* Status dot. With an avatar it becomes a badge pinned to the
							    avatar's top-right corner, ringed in the colour of whatever
							    surface is behind it, and stays put through hover — the avatar
							    fades to reveal the chevron, but "unread" / "this run failed"
							    must not blink out from under the pointer. Without an agent
							    there is nothing to badge, so it keeps its original behaviour:
							    centred in the slot, crossfading out for the chevron.
							    Deliberately outside the `latestAgent` branch — an agentless
							    chat losing its unread state entirely is the bug this shape
							    exists to avoid. */}
							{showDot &&
								(latestAgent || groupConversation ? (
									<span
										aria-label={runStatus?.description ?? "Unread"}
										className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${dotRingClass} ${runStatus?.dotClass ?? "bg-primary"}`}
										title={runStatus?.description ?? "Unread"}
									/>
								) : (
									<span
										aria-label={runStatus?.description ?? "Unread"}
										className={`absolute inset-0 m-auto size-1.5 rounded-full transition-opacity ${
											rowExpanded
												? "opacity-0"
												: "opacity-100 group-hover/row:opacity-0"
										} ${runStatus?.dotClass ?? "bg-primary"}`}
										title={runStatus?.description ?? "Unread"}
									/>
								))}
							{/* Chevron: hidden at rest, fades in on hover; always shown (and
							    un-rotated) once expanded so it can be collapsed again. */}
							<HugeiconsIcon
								className={`size-3 transition-all ${
									rowExpanded
										? "opacity-100"
										: "-rotate-90 opacity-0 group-hover/row:opacity-100"
								}`}
								icon={ArrowDown01Icon}
							/>
						</button>
						{conv.icon ? (
							<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
								<GlyphDisplay fallback={null} size={14} value={conv.icon} />
							</span>
						) : null}
						{isPinned && (
							<HugeiconsIcon
								className="size-3 shrink-0 text-muted-foreground/70"
								icon={PinIcon}
							/>
						)}
						{isForkedConversation(conv) ? (
							<HugeiconsIcon
								aria-label="Forked thread"
								className="size-3 shrink-0 text-primary/75"
								icon={GitBranchIcon}
							/>
						) : null}
						<ResourceVisibilityIndicator visibility={conv.visibility} />
						{isEditing ? (
							<input
								className="min-w-0 flex-1 rounded-sm bg-transparent text-sm outline-none ring-1 ring-primary/40 focus:ring-primary"
								onBlur={commitEditing}
								onChange={(e) => setDraftTitle(e.target.value)}
								onClick={(e) => e.stopPropagation()}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter") {
										commitEditing();
									} else if (e.key === "Escape") {
										cancelEditing();
									}
								}}
								ref={inputRef}
								value={draftTitle}
							/>
						) : (
							// Wrap the preview so a double-click on the title starts an
							// inline rename (SidebarItemPreview doesn't forward DOM handlers).
							// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: double-click rename on tooltip wrapper
							<span
								className="flex min-w-0 flex-1 flex-col justify-center"
								onDoubleClick={(e) => {
									e.stopPropagation();
									startEditing();
								}}
							>
								<span className="flex min-w-0 items-center">
									{/* One label for both states (FadeLabel, not OverflowTooltip —
									    the row already has the hover-card preview, and a second
									    popup would fight it). Running only swaps the shimmer onto
									    the same clipped line, so the title dissolves at the edge in
									    either state and the row cannot jump when a run starts. */}
									<SidebarItemPreview
										className="min-w-0 flex-1 p-1"
										content={previewContent}
										renderContent={(open) =>
											open &&
											pullRequestsEnabled &&
											folderPath &&
											conv.branch ? (
												<SidebarGitPullRequestPreview
													branch={conv.branch}
													cwd={folderPath}
													showStatusIcon={interfaceLevel !== "simple"}
													target={target}
												/>
											) : null
										}
									>
										<FadeLabel
											className={`flex-1 text-sm ${isUnread ? "font-medium" : ""}`}
											shimmer={isRunning}
											text={conv.title}
										/>
									</SidebarItemPreview>
								</span>
								{showSidebarChatPreview ? (
									<SidebarConversationPreview
										className="px-1"
										states={sidebarPreviewStates}
										testId={`sidebar-chat-preview-${conv.id}`}
									/>
								) : null}
							</span>
						)}
						{interfaceLevel !== "simple" &&
						pullRequestsEnabled &&
						codeSession &&
						folderPath &&
						conv.branch ? (
							<SidebarGitPullRequestStatus
								branch={conv.branch}
								cwd={folderPath}
								target={target}
							/>
						) : null}
						{isRunning ? (
							// A live run shows a spinner in place of the age (like ChatGPT's
							// per-chat "running" indicator) so several concurrent chats are
							// legible at a glance. Hidden on hover so the ⋯ menu can take its slot.
							<Spinner
								animated={animationsEnabled}
								aria-label="Running"
								className="size-3.5 shrink-0 text-muted-foreground/70 group-hover/row:hidden"
							/>
						) : runStatus?.needsAttention ? (
							<span
								className={`shrink-0 text-[10px] tabular-nums ${
									conv.runStatus === "failed"
										? "text-destructive"
										: "text-amber-600 dark:text-amber-400"
								}`}
								title={runStatus.description}
							>
								{runStatus.label}
							</span>
						) : (
							<span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums group-hover/row:hidden">
								{compactAge(conv.updatedAt)}
							</span>
						)}
						<button
							aria-label={pinLabel}
							aria-pressed={isPinned}
							className="hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent group-hover/row:inline-flex"
							onClick={(e) => {
								e.stopPropagation();
								onTogglePin(conv.id);
							}}
							type="button"
						>
							<HugeiconsIcon icon={pinIcon} size={12} />
						</button>
						<button
							aria-label={archiveLabel}
							aria-pressed={isArchived}
							className="hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent group-hover/row:inline-flex"
							onClick={(e) => {
								e.stopPropagation();
								onToggleArchive(conv.id);
							}}
							type="button"
						>
							<HugeiconsIcon icon={archiveIcon} size={12} />
						</button>
						<DropdownMenu>
							{/* data-[popup-open] keeps the trigger visible while the menu is
							    open. Without it, moving onto the menu drops group-hover, the
							    trigger goes display:none, and Base UI loses its anchor (the menu
							    jumps to the top-left). Base UI sets data-popup-open, not
							    data-state, on the trigger. */}
							<DropdownMenuTrigger
								className="hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent group-hover/row:inline-flex data-[popup-open]:inline-flex"
								onClick={(e) => e.stopPropagation()}
							>
								<HugeiconsIcon icon={MoreHorizontalIcon} size={12} />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onOpenInNewTab(conv.id);
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={ArrowUpRight01Icon}
										size={12}
									/>
									Open in new tab
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										void copyChatTranscript(() => loadMessages(conv.id));
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={ClipboardIcon}
										size={12}
									/>
									Copy transcript
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										if (isUnread) {
											onMarkRead(conv.id);
										} else {
											onMarkUnread(conv.id);
										}
									}}
								>
									<HugeiconsIcon className="mr-2" icon={Mail01Icon} size={12} />
									{readLabel}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										startEditing();
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={PencilEdit01Icon}
										size={12}
									/>
									Rename
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										setIconDialogOpen(true);
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={ImageAdd01Icon}
										size={12}
									/>
									Change icon…
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={shared && !handlers.canMakePrivate}
									onClick={(e) => {
										e.stopPropagation();
										handlers.onRequestConversationVisibility({
											from: visibilityGroup,
											id: conv.id,
											name: conv.title,
											resourceType: "chat",
											to: nextVisibility === "private" ? "private" : "team",
										});
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={shared ? ViewOffSlashIcon : UserMultiple02Icon}
										size={12}
									/>
									{shared && !handlers.canMakePrivate
										? "Make private (admins only)"
										: visibilityActionLabel}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onTogglePin(conv.id);
									}}
								>
									<HugeiconsIcon className="mr-2" icon={pinIcon} size={12} />
									{pinLabel}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onToggleArchive(conv.id);
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={archiveIcon}
										size={12}
									/>
									{archiveLabel}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										toggleLearningExclusion();
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={ViewOffSlashIcon}
										size={12}
									/>
									{learningLabel}
								</DropdownMenuItem>
								{contributedMenuRows.length > 0 && <DropdownMenuSeparator />}
								{contributedMenuRows.map((item) => (
									<DropdownMenuItem
										key={item.id}
										onClick={(e) => {
											e.stopPropagation();
											runContributedRow(item);
										}}
									>
										{item.icon ? (
											<Icon className="mr-2" icon={item.icon} size={12} />
										) : (
											<HugeiconsIcon
												className="mr-2"
												icon={MoreHorizontalIcon}
												size={12}
											/>
										)}
										{item.label}
									</DropdownMenuItem>
								))}
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onClick={(e) => {
										e.stopPropagation();
										setConfirmDeleteOpen(true);
									}}
								>
									<HugeiconsIcon
										className="mr-2"
										icon={Delete01Icon}
										size={12}
									/>
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => onOpenInNewTab(conv.id)}>
						<HugeiconsIcon className="mr-2 size-4" icon={ArrowUpRight01Icon} />
						Open in new tab
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => {
							void copyChatTranscript(() => loadMessages(conv.id));
						}}
					>
						<HugeiconsIcon className="mr-2 size-4" icon={ClipboardIcon} />
						Copy transcript
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() =>
							isUnread ? onMarkRead(conv.id) : onMarkUnread(conv.id)
						}
					>
						<HugeiconsIcon className="mr-2 size-4" icon={Mail01Icon} />
						{readLabel}
					</ContextMenuItem>
					<ContextMenuItem onClick={startEditing}>
						<HugeiconsIcon className="mr-2 size-4" icon={PencilEdit01Icon} />
						Rename
					</ContextMenuItem>
					<ContextMenuItem onClick={() => setIconDialogOpen(true)}>
						<HugeiconsIcon className="mr-2 size-4" icon={ImageAdd01Icon} />
						Change icon…
					</ContextMenuItem>
					<ContextMenuItem
						disabled={shared && !handlers.canMakePrivate}
						onClick={() =>
							handlers.onRequestConversationVisibility({
								from: visibilityGroup,
								id: conv.id,
								name: conv.title,
								resourceType: "chat",
								to: nextVisibility === "private" ? "private" : "team",
							})
						}
					>
						<HugeiconsIcon
							className="mr-2 size-4"
							icon={shared ? ViewOffSlashIcon : UserMultiple02Icon}
						/>
						{shared && !handlers.canMakePrivate
							? "Make private (admins only)"
							: visibilityActionLabel}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => onTogglePin(conv.id)}>
						<HugeiconsIcon className="mr-2 size-4" icon={pinIcon} />
						{pinLabel}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => onToggleArchive(conv.id)}>
						<HugeiconsIcon className="mr-2 size-4" icon={archiveIcon} />
						{archiveLabel}
					</ContextMenuItem>
					<ContextMenuItem onClick={toggleLearningExclusion}>
						<HugeiconsIcon className="mr-2 size-4" icon={ViewOffSlashIcon} />
						{learningLabel}
					</ContextMenuItem>
					{/* Same contributed rows the ⋯ dropdown renders, in the same slot and
					    order. Right-clicking a chat is the more discoverable gesture of the
					    two, so an app-registered row missing here read as the app simply
					    not contributing anything. */}
					{contributedMenuRows.length > 0 && <ContextMenuSeparator />}
					{contributedMenuRows.map((item) => (
						<ContextMenuItem
							key={item.id}
							onClick={() => runContributedRow(item)}
						>
							{item.icon ? (
								<Icon className="mr-2 size-4" icon={item.icon} size={16} />
							) : (
								<HugeiconsIcon
									className="mr-2 size-4"
									icon={MoreHorizontalIcon}
								/>
							)}
							{item.label}
						</ContextMenuItem>
					))}
					<ContextMenuSeparator />
					<ContextMenuItem
						className="text-destructive"
						onClick={() => setConfirmDeleteOpen(true)}
					>
						<HugeiconsIcon className="mr-2 size-4" icon={Delete01Icon} />
						Delete
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{rowExpanded && (
				<div className="flex flex-col gap-0.5 pb-1">
					<ChatRowSubAccordion
						expanded={messagesExpanded}
						label="Messages"
						onToggle={() => setMessagesExpanded((v) => !v)}
					>
						<SidebarChatMessages
							agentId={conv.agentId}
							conversationId={conv.id}
							loadMessages={loadMessages}
							onJump={(messageId) => onJumpToMessage(conv.id, messageId)}
						/>
					</ChatRowSubAccordion>
					{sideChatsEnabled && (
						<ChatRowSubAccordion
							expanded={sideChatsExpanded}
							label="Side chats"
							onToggle={() => setSideChatsExpanded((v) => !v)}
						>
							<SidebarSideChats
								conversationId={conv.id}
								onOpen={(entry) => onOpenSideChat(conv.id, entry)}
								target={target}
							/>
						</ChatRowSubAccordion>
					)}
				</div>
			)}
			<AlertDialog onOpenChange={setConfirmDeleteOpen} open={confirmDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this chat?</AlertDialogTitle>
						<AlertDialogDescription>
							{`"${conv.title}" will be permanently deleted. This cannot be undone.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => onDeleteConversation(conv.id)}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<EntityIconDialog
				description={conv.title}
				onChange={(icon) => onSetConversationIcon(conv.id, icon)}
				onOpenChange={setIconDialogOpen}
				open={iconDialogOpen}
				title="Chat icon"
				value={conv.icon ?? null}
			/>
		</SidebarMenuItem>
	);
}
