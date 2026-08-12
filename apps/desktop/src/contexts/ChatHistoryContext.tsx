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
import {
	setConversationIcon,
	setConversationTitle,
} from "@/src/lib/api/conversation-flags.ts";
import { useCoreRefresh } from "@/src/lib/core-refresh.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import type { Conversation, Message } from "@/types/chat.ts";

interface ChatHistoryContextValue {
	activeConversationId: string | null;
	conversations: Conversation[];
	/** Optimistically add a draft conversation locally; it is persisted in Core
	 * by the chat stream once the first message is sent. */
	createConversation: (id: string, agentId?: string, title?: string) => void;
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
	/** Fetch a conversation's full message history from Core. */
	loadMessages: (id: string) => Promise<Message[]>;
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
	/** Set or clear a conversation glyph (optimistic + Core write-through). */
	setConversationGlyph: (id: string, icon: GlyphValue) => void;
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
	message_count: number;
	participants?: string[];
	pinned?: boolean;
	run_status: string | null;
	title: string | null;
	updated_at: number;
	worktree_path: string | null;
}

// Server-side shape returned by Core's `GET /api/conversations/:id`.
interface CoreMessage {
	content: string;
	created_at: number;
	id: string;
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
	};
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
	const activeNode = useNodeStore((s) => s.getActiveNode());
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<
		string | null
	>(null);

	const refresh = useCallback(() => {
		const { url, token } = activeNode;
		fetch(`${url}/api/conversations`, { headers: authHeaders(token) })
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
			});
	}, [activeNode]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Auto-recover the conversation list when Core reconnects or the user hits
	// "Refresh all" — no manual "Try again" in the sidebar history.
	useCoreRefresh(refresh);

	const createConversation = useCallback(
		(id: string, agentId?: string, title?: string) => {
			setConversations((prev) => {
				if (prev.some((c) => c.id === id)) {
					return prev;
				}
				const now = Date.now();
				const draft: Conversation = {
					id,
					agentId,
					title: title ?? UNTITLED,
					messages: [],
					createdAt: now,
					updatedAt: now,
				};
				return [draft, ...prev];
			});
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

	const listConversations = useCallback(
		() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
		[conversations]
	);

	const loadMessages = useCallback(
		async (id: string): Promise<Message[]> => {
			const { url, token } = activeNode;
			try {
				const res = await fetch(
					`${url}/api/conversations/${encodeURIComponent(id)}`,
					{
						headers: authHeaders(token),
					}
				);
				if (!res.ok) {
					return [];
				}
				const data: { messages?: CoreMessage[] } = await res.json();
				return (data.messages ?? []).map((m) => ({
					id: m.id,
					role: m.role === "assistant" ? "assistant" : "user",
					content: m.content,
					// Carry through the structured parts when Core has them, so the
					// chat page can rehydrate tool rows + cowork context instead of
					// only flat text (see ChatPage's hydration).
					parts:
						Array.isArray(m.parts) && m.parts.length > 0 ? m.parts : undefined,
					siblingIndex: m.sibling_index,
					siblingCount: m.sibling_count,
					siblingIds: m.sibling_ids,
					parentMessageId: m.parent_message_id,
					timestamp: m.created_at,
				}));
			} catch {
				return [];
			}
		},
		[activeNode]
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
			activeConversationId,
			createConversation,
			getConversation,
			deleteConversation,
			renameConversation,
			setConversationGlyph,
			setActiveConversationId,
			listConversations,
			loadMessages,
			forkConversation,
			editMessage,
			regenerateMessage,
			selectVersion,
			seedTitleFromFirstMessage,
			refresh,
		}),
		[
			conversations,
			activeConversationId,
			createConversation,
			getConversation,
			deleteConversation,
			renameConversation,
			setConversationGlyph,
			listConversations,
			loadMessages,
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
