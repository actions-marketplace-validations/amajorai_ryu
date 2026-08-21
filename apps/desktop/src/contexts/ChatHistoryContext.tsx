import type { GlyphValue } from "@ryu/ui/components/glyph.ts";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useMessagingRows } from "@/src/hooks/useAgentRowStyle.ts";
import { useSidebarChatPreview } from "@/src/hooks/useSidebarChatPreview.ts";
import {
	setConversationIcon,
	setConversationTitle,
	setConversationVisibility as setConversationVisibilityApi,
} from "@/src/lib/api/conversation-flags.ts";
import { useCoreRefresh } from "@/src/lib/core-refresh.ts";
import {
	type ResourceVisibility,
	toResourceVisibility,
} from "@/src/lib/resource-visibility.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import type { Conversation, Message } from "@/types/chat.ts";

/** Outcome of a history fetch. An empty thread and an unreachable node produce
 * the same `messages: []`, and telling them apart is the whole difference
 * between "this chat is new" and "this chat has not loaded" — see
 * `loadMessagesResult`. */
interface LoadMessagesResult {
	hasOlderMessages?: boolean;
	messages: Message[];
	olderMessagesCursor?: string;
	status: "error" | "ok";
}

interface ChatHistoryContextValue {
	activeConversationId: string | null;
	conversations: Conversation[];
	/** True while the first conversation-list fetch for this node is in flight.
	 * Consumers must gate a skeleton on `conversations.length === 0` as well —
	 * `refresh` re-runs on node/preview changes and must not flash over a list
	 * that is already on screen. */
	conversationsLoading: boolean;
	/** Optimistically add a draft conversation locally; it is persisted in Core
	 * by the chat stream once the first message is sent.
	 *
	 * Pass `folderPath` whenever a workspace folder is active — the sidebar
	 * buckets rows by it, so a draft created without it lands in the loose
	 * "Chats" list and only moves under its project when Core's row arrives
	 * after the first turn. See {@link DraftInit}. */
	createConversation: (id: string, init?: DraftInit) => void;
	deleteConversation: (id: string) => void;
	/** Edit a user message in place: creates a new version (sibling) carrying
	 * `content` and switches the active branch to it. Returns the new message id
	 * (the caller streams a reply with skip_user_append), or null on failure. */
	editMessage: (
		id: string,
		messageId: string,
		content: string
	) => Promise<string | null>;
	/** Branch (fork) a conversation into a new one, copying history up to (and
	 * including) `messageId`. Returns the new conversation's id, or null on
	 * failure. The new conversation is added to the local list optimistically. */
	forkConversation: (id: string, messageId: string) => Promise<string | null>;
	getConversation: (id: string) => Conversation | undefined;
	listConversations: () => Conversation[];
	/** Fetch a conversation's full message history from Core. Returns `[]` for a
	 * failed fetch as well as an empty thread — use `loadMessagesResult` when the
	 * caller has to tell those apart. */
	loadMessages: (id: string) => Promise<Message[]>;
	/** Fetch the newest message page, or the page immediately before `before`.
	 * The cursor is an opaque Core message id and is only advanced after the
	 * page has been merged into the visible transcript. */
	loadMessagesPageResult: (
		id: string,
		before?: string
	) => Promise<LoadMessagesResult>;
	/** `loadMessages` with the transport outcome kept: `status: "error"` means the
	 * node could not be reached (or answered non-2xx), NOT that the conversation
	 * is empty. The chat surface needs the distinction to show "still loading /
	 * couldn't load" instead of the new-chat greeting. */
	loadMessagesResult: (id: string) => Promise<LoadMessagesResult>;
	/** Re-sync the conversation list from Core. */
	refresh: () => void;
	/** Prepare to regenerate an assistant message: points the active leaf at the
	 * user turn above it so a subsequent stream appends a fresh assistant version.
	 * Returns true on success. */
	regenerateMessage: (id: string, messageId: string) => Promise<boolean>;
	/** Rename a conversation: updates the local title immediately (optimistic) and
	 * writes through to Core so the new title is server-backed and shared. */
	renameConversation: (id: string, title: string) => void;
	/** Name a still-unnamed conversation after the message being sent, using the
	 * same rule Core applies when it persists the turn. Local state only — this is
	 * NOT a rename, so it never marks the title user-chosen and never blocks the
	 * chat-title plugin from replacing it. A no-op once the row has a real title. */
	seedTitleFromFirstMessage: (id: string, content: string) => void;
	/** Switch the active version at a branch point to `versionId`; the caller then
	 * reloads the active path to re-render the selected branch. */
	selectVersion: (id: string, versionId: string) => Promise<boolean>;
	setActiveConversationId: (id: string | null) => void;
	/** Record which workspace folder a conversation is running in, locally.
	 *
	 * Local state only — Core stamps the same value itself from the turn's `cwd`
	 * (`set_run_metadata`), so this is not a write-through, it just removes the
	 * wait. Call it at send time with the folder the turn is about to run
	 * against: a draft created before the user switched folders would otherwise
	 * sit under the wrong project until the list refreshes. */
	setConversationFolder: (id: string, folderPath?: string) => void;
	/** Set or clear a conversation glyph (optimistic + Core write-through). */
	setConversationGlyph: (id: string, icon: GlyphValue) => void;
	/** Set a conversation's private or team visibility (optimistic + Core write-through). */
	setConversationVisibility: (
		id: string,
		visibility: ResourceVisibility
	) => Promise<boolean>;
}

/** The fields a caller may seed on an optimistic draft conversation. */
interface DraftInit {
	agentId?: string;
	/** Workspace folder the chat belongs to — what the sidebar groups by. */
	folderPath?: string;
	title?: string;
}

const ChatHistoryContext = createContext<ChatHistoryContextValue | null>(null);

export function useChatHistoryContext() {
	const ctx = useContext(ChatHistoryContext);
	if (!ctx) {
		throw new Error(
			"useChatHistoryContext must be used within ChatHistoryProvider"
		);
	}
	return ctx;
}

// Server-side shape returned by Core's `GET /api/conversations`.
interface CoreConversationSummary {
	agent_id: string | null;
	archived?: boolean;
	branch: string | null;
	created_at: number;
	folder_path: string | null;
	icon?: GlyphValue;
	id: string;
	/** Only present when the list was fetched with `?preview=1`. */
	last_message?: string;
	last_message_at?: number;
	last_message_role?: string;
	message_count: number;
	participants?: string[];
	pinned?: boolean;
	run_status: string | null;
	title: string | null;
	updated_at: number;
	visibility?: string;
	worktree_path: string | null;
}

// Server-side shape returned by Core's `GET /api/conversations/:id`.
interface CoreMessage {
	content: string;
	created_at: number;
	id: string;
	/** Set by Core's boot reconciliation on an assistant turn the node died in
	 * the middle of — its text/parts are whatever had been flushed. */
	interrupted?: boolean;
	origin_server?: string | null;
	parent_message_id?: string;
	/**
	 * Structured render parts (AI SDK reduced UIMessage `parts` array) captured
	 * server-side as an assistant turn streamed. Present only for assistant turns
	 * that ran tools/media after parts capture existed; absent otherwise (the
	 * client falls back to a text part from `content`).
	 */
	parts?: unknown[];
	role: string;
	sibling_count?: number;
	sibling_ids?: string[];
	/** Version-tree fields from Core's active-path read. */
	sibling_index?: number;
	source?: string | null;
	widget_instance_id?: string | null;
}

interface CoreConversationPage {
	has_older_messages?: boolean;
	messages?: CoreMessage[];
	older_messages_cursor?: string | null;
}

const CHAT_HISTORY_PAGE_SIZE = 40;

function mapCoreMessages(messages: CoreMessage[] | undefined): Message[] {
	return (messages ?? []).map((m) => ({
		id: m.id,
		role: m.role === "assistant" ? "assistant" : "user",
		content: m.content,
		originServer:
			typeof m.origin_server === "string" ? m.origin_server : undefined,
		source: m.source ?? undefined,
		// Carry through the structured parts when Core has them, so the
		// chat page can rehydrate tool rows + cowork context instead of
		// only flat text (see ChatPage's hydration).
		parts: Array.isArray(m.parts) && m.parts.length > 0 ? m.parts : undefined,
		interrupted: m.interrupted === true,
		siblingIndex: m.sibling_index,
		siblingCount: m.sibling_count,
		siblingIds: m.sibling_ids,
		parentMessageId: m.parent_message_id,
		timestamp: m.created_at,
		widgetInstanceId:
			typeof m.widget_instance_id === "string"
				? m.widget_instance_id
				: undefined,
	}));
}

function authHeaders(token: string | null): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The title a conversation carries until it has been named — the only string
 * `seedTitleFromFirstMessage` is allowed to overwrite. */
const UNTITLED = "New Chat";
/** Longest derived title, in characters. Matches Core's `derive_title` cap. */
const DERIVED_TITLE_MAX = 60;

/**
 * Mirror of Core's `derive_title` (apps/core/src/server/conversations.rs): the
 * first line of the message, capped at 60 characters with an ellipsis. Core runs
 * the same rule when it persists the turn; doing it client-side too is what makes
 * the sidebar row read as the message *immediately* instead of after the reply
 * lands. The two must stay byte-identical or the title visibly changes under the
 * user when the list refreshes.
 *
 * Returns null for a text-less message (an image- or file-only opener), matching
 * Core's `None` — better an honest placeholder than a title of "".
 */
function deriveDraftTitle(content: string): string | null {
	const firstLine = content.trim().split("\n")[0]?.trim() ?? "";
	if (!firstLine) {
		return null;
	}
	const chars = [...firstLine];
	return chars.length <= DERIVED_TITLE_MAX
		? firstLine
		: `${chars.slice(0, DERIVED_TITLE_MAX).join("")}…`;
}

function summaryToConversation(summary: CoreConversationSummary): Conversation {
	return {
		id: summary.id,
		title: summary.title ?? UNTITLED,
		agentId: summary.agent_id ?? undefined,
		participants: summary.participants?.length
			? summary.participants
			: undefined,
		messages: [],
		createdAt: summary.created_at,
		updatedAt: summary.updated_at,
		folderPath: summary.folder_path ?? undefined,
		branch: summary.branch ?? undefined,
		worktreePath: summary.worktree_path ?? undefined,
		runStatus: summary.run_status ?? undefined,
		pinned: summary.pinned ?? false,
		archived: summary.archived ?? false,
		icon: summary.icon ?? null,
		lastMessage: summary.last_message,
		lastMessageRole: summary.last_message_role,
		lastMessageAt: summary.last_message_at,
		messageCount: summary.message_count,
		visibility: toResourceVisibility(summary.visibility),
	};
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
	const activeNode = useNodeStore((s) => s.getActiveNode());
	const [conversations, setConversations] = useState<Conversation[]>([]);
	// Seeded `true`, not `false`: the very first render happens before `refresh`
	// has even been called, and a list that reports "not loading, zero chats" in
	// that window is what makes a booting app look like a fresh install.
	const [conversationsLoading, setConversationsLoading] = useState(true);
	const [activeConversationId, setActiveConversationId] = useState<
		string | null
	>(null);

	// Message previews are the second line of the messaging-style sidebar rows.
	// They cost Core a subquery + a decrypt per conversation, so the list is only
	// asked for them while that row style is switched on — flipping the pref
	// re-runs this effect and the previews arrive (or stop) on the next tick.
	const [sidebarChatPreview] = useSidebarChatPreview();
	const wantPreview = useMessagingRows() || sidebarChatPreview;

	const refresh = useCallback(() => {
		const { url, token } = activeNode;
		const query = wantPreview ? "?preview=1" : "";
		setConversationsLoading(true);
		fetch(`${url}/api/conversations${query}`, { headers: authHeaders(token) })
			.then((res) =>
				res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
			)
			.then((data: { conversations?: CoreConversationSummary[] }) => {
				const fromCore = (data.conversations ?? []).map(summaryToConversation);
				// Keep any local draft conversations that have not been persisted yet.
				setConversations((prev) => {
					const coreIds = new Set(fromCore.map((c) => c.id));
					const drafts = prev.filter(
						(c) => !coreIds.has(c.id) && c.messages.length === 0
					);
					// A Core row replaces its local copy wholesale, so a row Core has
					// not titled yet would drag a locally seeded title back to the
					// placeholder — the sidebar would show the user's message on send
					// and then revert. Core normally derives the same title from the
					// first user message, but any route that persists a turn without
					// text (or without reaching that path) leaves the column NULL, and
					// a title must never travel backwards. So: an untitled row inherits
					// whatever name it already had on screen.
					const localTitles = new Map(
						prev.filter((c) => c.title !== UNTITLED).map((c) => [c.id, c.title])
					);
					const merged = fromCore.map((c) =>
						c.title === UNTITLED && localTitles.has(c.id)
							? { ...c, title: localTitles.get(c.id) as string }
							: c
					);
					return [...drafts, ...merged];
				});
			})
			.catch(() => {
				// Core may be offline; keep whatever is in memory.
			})
			.finally(() => {
				setConversationsLoading(false);
			});
	}, [activeNode, wantPreview]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Auto-recover the conversation list when Core reconnects or the user hits
	// "Refresh all" — no manual "Try again" in the sidebar history.
	useCoreRefresh(refresh);

	const createConversation = useCallback((id: string, init?: DraftInit) => {
		setConversations((prev) => {
			if (prev.some((c) => c.id === id)) {
				return prev;
			}
			const now = Date.now();
			const draft: Conversation = {
				id,
				agentId: init?.agentId,
				title: init?.title ?? UNTITLED,
				// The sidebar groups by this. Seeding it here is what puts a chat
				// started inside a project under that project IMMEDIATELY, instead of
				// showing up as a loose chat until Core's row (which carries the same
				// folder, stamped from the turn's cwd) replaces the draft.
				folderPath: init?.folderPath,
				messageCount: 0,
				messages: [],
				createdAt: now,
				updatedAt: now,
			};
			return [draft, ...prev];
		});
	}, []);

	const setConversationFolder = useCallback(
		(id: string, folderPath?: string) => {
			// No folder ⇒ nothing to record. Core's `set_run_metadata` COALESCEs, so a
			// turn run with no cwd never clears a folder the conversation already has;
			// mirroring that here keeps the two from disagreeing.
			if (!folderPath) {
				return;
			}
			setConversations((prev) =>
				prev.map((c) =>
					c.id === id && c.folderPath !== folderPath ? { ...c, folderPath } : c
				)
			);
		},
		[]
	);

	// Default chat naming, independent of any plugin: the moment the user sends,
	// the thread is called what they asked. Core derives the identical title when
	// it persists the turn, so this only removes the round trip — nothing here is
	// written back, and the guard on `UNTITLED` keeps a later send (or a title the
	// chat-title plugin already produced) from being overwritten.
	const seedTitleFromFirstMessage = useCallback(
		(id: string, content: string) => {
			const derived = deriveDraftTitle(content);
			if (!derived) {
				return;
			}
			setConversations((prev) =>
				prev.map((c) =>
					c.id === id && c.title === UNTITLED ? { ...c, title: derived } : c
				)
			);
		},
		[]
	);

	const getConversation = useCallback(
		(id: string) => conversations.find((c) => c.id === id),
		[conversations]
	);

	const deleteConversation = useCallback(
		(id: string) => {
			setConversations((prev) => prev.filter((c) => c.id !== id));
			const { url, token } = activeNode;
			fetch(`${url}/api/conversations/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: authHeaders(token),
			}).catch(() => {
				// Best-effort: the row is already gone from the UI.
			});
		},
		[activeNode]
	);

	const renameConversation = useCallback(
		(id: string, title: string) => {
			const trimmed = title.trim();
			if (!trimmed) {
				return;
			}
			setConversations((prev) =>
				prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c))
			);
			// Write through with the typed client (best-effort): the optimistic local
			// title already shows; a failed write just means it isn't server-backed.
			const { url, token } = activeNode;
			Promise.resolve(setConversationTitle({ url, token }, id, trimmed)).catch(
				() => undefined
			);
		},
		[activeNode]
	);

	const setConversationGlyph = useCallback(
		(id: string, icon: GlyphValue) => {
			setConversations((prev) =>
				prev.map((c) => (c.id === id ? { ...c, icon } : c))
			);
			const { url, token } = activeNode;
			Promise.resolve(setConversationIcon({ url, token }, id, icon)).catch(
				() => undefined
			);
		},
		[activeNode]
	);

	const setConversationVisibility = useCallback(
		async (id: string, visibility: ResourceVisibility) => {
			setConversations((prev) =>
				prev.map((conversation) =>
					conversation.id === id
						? { ...conversation, visibility }
						: conversation
				)
			);
			const { url, token } = activeNode;
			const success = await setConversationVisibilityApi(
				{ url, token },
				id,
				visibility
			);
			if (!success) {
				// A refresh restores the server value; keeping this best-effort mirrors
				// the existing pin/archive/icon controls.
				refresh();
			}
			return success;
		},
		[activeNode, refresh]
	);

	const listConversations = useCallback(
		() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
		[conversations]
	);

	const loadMessagesResult = useCallback(
		async (id: string): Promise<LoadMessagesResult> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}`,
					{
						headers: authHeaders(token),
					}
				);
				// 404 is an ANSWER, not a failure: the node is up and says this
				// conversation is gone (deleted, or never persisted). That is the
				// "does not exist" state, which correctly falls through to the
				// new-chat surface — unlike an unreachable node, which must not.
				if (res.status === 404) {
					return { status: "ok", messages: [] };
				}
				if (!res.ok) {
					return { status: "error", messages: [] };
				}
				const data: { messages?: CoreMessage[] } = await res.json();
				return {
					status: "ok",
					messages: mapCoreMessages(data.messages),
				};
			} catch {
				return { status: "error", messages: [] };
			}
		},
		[activeNode]
	);

	const loadMessagesPageResult = useCallback(
		async (id: string, before?: string): Promise<LoadMessagesResult> => {
			const { url, token } = activeNode;
			const query = new URLSearchParams({
				limit: String(CHAT_HISTORY_PAGE_SIZE),
			});
			if (before) {
				query.set("before", before);
			}
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}?${query.toString()}`,
					{
						headers: authHeaders(token),
					}
				);
				if (res.status === 404) {
					return {
						hasOlderMessages: false,
						messages: [],
						status: "ok",
					};
				}
				if (!res.ok) {
					return { messages: [], status: "error" };
				}
				const data: CoreConversationPage = await res.json();
				return {
					hasOlderMessages: data.has_older_messages === true,
					messages: mapCoreMessages(data.messages),
					olderMessagesCursor:
						typeof data.older_messages_cursor === "string"
							? data.older_messages_cursor
							: undefined,
					status: "ok",
				};
			} catch {
				return { messages: [], status: "error" };
			}
		},
		[activeNode]
	);

	const loadMessages = useCallback(
		async (id: string): Promise<Message[]> => {
			const { messages } = await loadMessagesResult(id);
			return messages;
		},
		[loadMessagesResult]
	);

	const forkConversation = useCallback(
		async (id: string, messageId: string): Promise<string | null> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}/fork`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...authHeaders(token),
						},
						body: JSON.stringify({ message_id: messageId }),
					}
				);
				if (!res.ok) {
					return null;
				}
				const data: { conversation?: CoreConversationSummary } =
					await res.json();
				if (!data.conversation) {
					return null;
				}
				const forked = summaryToConversation(data.conversation);
				setConversations((prev) =>
					prev.some((c) => c.id === forked.id) ? prev : [forked, ...prev]
				);
				return forked.id;
			} catch {
				return null;
			}
		},
		[activeNode]
	);

	const editMessage = useCallback(
		async (
			id: string,
			messageId: string,
			content: string
		): Promise<string | null> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/edit`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...authHeaders(token),
						},
						body: JSON.stringify({ content }),
					}
				);
				if (!res.ok) {
					return null;
				}
				const data: { message_id?: string } = await res.json();
				return data.message_id ?? null;
			} catch {
				return null;
			}
		},
		[activeNode]
	);

	const regenerateMessage = useCallback(
		async (id: string, messageId: string): Promise<boolean> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/regenerate`,
					{
						method: "POST",
						headers: authHeaders(token),
					}
				);
				return res.ok;
			} catch {
				return false;
			}
		},
		[activeNode]
	);

	const selectVersion = useCallback(
		async (id: string, versionId: string): Promise<boolean> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(versionId)}/select`,
					{
						method: "POST",
						headers: authHeaders(token),
					}
				);
				return res.ok;
			} catch {
				return false;
			}
		},
		[activeNode]
	);

	const value: ChatHistoryContextValue = useMemo(
		() => ({
			conversations,
			conversationsLoading,
			activeConversationId,
			createConversation,
			getConversation,
			deleteConversation,
			renameConversation,
			setConversationFolder,
			setConversationGlyph,
			setConversationVisibility,
			setActiveConversationId,
			listConversations,
			loadMessages,
			loadMessagesResult,
			loadMessagesPageResult,
			forkConversation,
			editMessage,
			regenerateMessage,
			selectVersion,
			seedTitleFromFirstMessage,
			refresh,
		}),
		[
			conversations,
			conversationsLoading,
			activeConversationId,
			createConversation,
			getConversation,
			deleteConversation,
			renameConversation,
			setConversationFolder,
			setConversationGlyph,
			setConversationVisibility,
			listConversations,
			loadMessages,
			loadMessagesResult,
			loadMessagesPageResult,
			forkConversation,
			editMessage,
			regenerateMessage,
			selectVersion,
			seedTitleFromFirstMessage,
			refresh,
		]
	);

	return (
		<ChatHistoryContext.Provider value={value}>
			{children}
		</ChatHistoryContext.Provider>
	);
}
