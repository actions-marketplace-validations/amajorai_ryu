// apps/desktop/src/components/layout/library-entity-menu.tsx
//
// The right-click menu for a Library item, in ONE place.
//
// The Library lists the same entities the sidebar lists — chats, agents,
// spaces, workflows, channels, identities, teams, meetings — but its cards had
// no context menu at all, so "rename this chat" meant leaving the page you were
// browsing on and finding the sidebar row. This module renders those verbs for
// a card, using the same vocabulary the sidebar rows and the tab menu already
// speak.
//
// It is deliberately a sibling of `tab-entity-menu.tsx`, not a copy of it: the
// contributed half comes from `useContributedRowsFor`, the anchor-agnostic
// factory that module exports precisely so a THIRD surface can offer the same
// app-registered rows without hardcoding an anchor (the bug its header comment
// documents). The shell-owned half differs — a card can be renamed and deleted,
// which a tab cannot — so only the verbs, not the rendering, live here.
//
// Nothing here fetches. Every mutation arrives as a callback from the page that
// already loaded the collection, so the menu adds no second data source.

import {
	Archive01Icon,
	ArchiveRestoreIcon,
	ArrowUpRight01Icon,
	ClipboardIcon,
	Delete01Icon,
	Mail01Icon,
	PencilEdit01Icon,
	PinIcon,
	PinOffIcon,
	StarIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "@ryu/ui/components/context-menu.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import { useCallback } from "react";
import { useChatHistoryContext } from "@/src/contexts/ChatHistoryContext.tsx";
import { copyChatTranscript } from "@/src/lib/copy-chat-transcript.ts";
import type { LibraryItemType } from "@/src/lib/library.ts";
import { useConversationFlagsStore } from "@/src/store/useConversationFlagsStore.ts";
import {
	type EntityRow,
	EntityRowGlyph,
	useContributedRowsFor,
} from "./tab-entity-menu.tsx";

/**
 * A factory returning the app-contributed rows for any Library item.
 *
 * The switch below IS the type→anchor table: each arm names the
 * `context_menu_items[].anchor` (and the payload key its id travels under) that
 * a Library type maps to. Only the five anchors the plugin surface actually
 * defines appear — the same set `tab-entity-menu.tsx` derives from a route.
 * Types with no anchor (team, meeting, identity) get no contributed rows rather
 * than being invented a vocabulary no app declares against.
 *
 * The five `useContributedRowsFor` calls are unconditional and in fixed order —
 * this is a hook, and the alternative (calling it per card, inside the list
 * render) is exactly what React forbids. The returned function is safe to call
 * anywhere, including inside `.map`.
 */
export function useLibraryContributedRows(): (
	type: LibraryItemType,
	id: string
) => EntityRow[] {
	const agent = useContributedRowsFor("agent", "agent_id");
	const channel = useContributedRowsFor("channel", "channel_id");
	const conversation = useContributedRowsFor("conversation", "conversation_id");
	const space = useContributedRowsFor("space", "space_id");
	const workflow = useContributedRowsFor("workflow", "workflow_id");
	return useCallback(
		(type: LibraryItemType, id: string) => {
			switch (type) {
				case "agent":
					return agent(id);
				case "channel":
					return channel(id);
				case "chat":
					return conversation(id);
				case "space":
					return space(id);
				case "workflow":
					return workflow(id);
				default:
					return [];
			}
		},
		[agent, channel, conversation, space, workflow]
	);
}

/** Everything the menu needs about one card. Every mutation is optional: a type
 *  whose hook exposes no such verb passes nothing and the row does not render,
 *  rather than showing an entry that would do nothing when clicked. */
export interface LibraryMenuItem {
	favorited: boolean;
	id: string;
	name: string;
	onOpen: () => void;
	/** Same destination, forced into a new tab. */
	onOpenInNewTab?: () => void;
	/** Opens the page's rename dialog for this item. */
	onRename?: () => void;
	/** Opens the page's delete confirmation for this item. */
	onRequestDelete?: () => void;
	onToggleFavorite: () => void;
	/** Why deletion is refused, when it is (a system Space). The row renders
	 *  disabled with this as its tooltip — a menu that silently drops a row reads
	 *  as a bug, which is the same call the sidebar's Spaces row makes. */
	removeBlockedReason?: string;
	type: LibraryItemType;
}

/**
 * The rows of a Library card's context menu, in the order the sidebar uses:
 * open verbs, then the type's own verbs, then favorite, then app contributions,
 * then delete last and destructive.
 *
 * Returns a Fragment — a wrapper element inside `ContextMenuContent` breaks the
 * menu's roving-focus keyboard navigation.
 */
export function LibraryItemMenuContent({
	contributedRows,
	item,
}: {
	/** From {@link useLibraryContributedRows}, called by the list renderer. */
	contributedRows: EntityRow[];
	item: LibraryMenuItem;
}) {
	const { loadMessages } = useChatHistoryContext();
	const pinnedIds = useConversationFlagsStore((s) => s.pinnedIds);
	const archivedIds = useConversationFlagsStore((s) => s.archivedIds);
	const unreadIds = useConversationFlagsStore((s) => s.unreadIds);
	const togglePin = useConversationFlagsStore((s) => s.togglePin);
	const toggleArchive = useConversationFlagsStore((s) => s.toggleArchive);
	const markRead = useConversationFlagsStore((s) => s.markRead);
	const markUnread = useConversationFlagsStore((s) => s.markUnread);

	const isChat = item.type === "chat";
	const isPinned = pinnedIds.has(item.id);
	const isArchived = archivedIds.has(item.id);
	const isUnread = unreadIds.has(item.id);

	return (
		<>
			<ContextMenuItem onClick={item.onOpen}>
				<HugeiconsIcon className="size-4" icon={ArrowUpRight01Icon} />
				Open
			</ContextMenuItem>
			{item.onOpenInNewTab ? (
				<ContextMenuItem onClick={item.onOpenInNewTab}>
					<HugeiconsIcon className="size-4" icon={ArrowUpRight01Icon} />
					Open in new tab
				</ContextMenuItem>
			) : null}
			{isChat ? (
				<>
					<ContextMenuItem
						onClick={() => {
							void copyChatTranscript(() => loadMessages(item.id));
						}}
					>
						<HugeiconsIcon className="size-4" icon={ClipboardIcon} />
						Copy transcript
					</ContextMenuItem>
					<ContextMenuItem
						onClick={() => (isUnread ? markRead(item.id) : markUnread(item.id))}
					>
						<HugeiconsIcon className="size-4" icon={Mail01Icon} />
						{isUnread ? "Mark as read" : "Mark as unread"}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => togglePin(item.id)}>
						<HugeiconsIcon
							className="size-4"
							icon={isPinned ? PinOffIcon : PinIcon}
						/>
						{isPinned ? "Unpin chat" : "Pin chat"}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => toggleArchive(item.id)}>
						<HugeiconsIcon
							className="size-4"
							icon={isArchived ? ArchiveRestoreIcon : Archive01Icon}
						/>
						{isArchived ? "Unarchive chat" : "Archive chat"}
					</ContextMenuItem>
				</>
			) : null}
			{item.onRename ? (
				<ContextMenuItem onClick={item.onRename}>
					<HugeiconsIcon className="size-4" icon={PencilEdit01Icon} />
					Rename…
				</ContextMenuItem>
			) : null}
			<ContextMenuItem onClick={item.onToggleFavorite}>
				<HugeiconsIcon className="size-4" icon={StarIcon} />
				{item.favorited ? "Remove from favorites" : "Add to favorites"}
			</ContextMenuItem>
			{contributedRows.length > 0 ? <ContextMenuSeparator /> : null}
			{contributedRows.map((row) => (
				<ContextMenuItem key={row.id} onClick={row.onSelect}>
					<EntityRowGlyph row={row} />
					{row.label}
				</ContextMenuItem>
			))}
			{item.removeBlockedReason ? (
				<>
					<ContextMenuSeparator />
					{/* The wrapper span carries the tooltip: a disabled item is
					    `pointer-events-none` and would never see the hover itself. */}
					<Tooltip>
						<TooltipTrigger render={<span className="block" />}>
							<ContextMenuItem disabled variant="destructive">
								<HugeiconsIcon className="size-4" icon={Delete01Icon} />
								Delete
							</ContextMenuItem>
						</TooltipTrigger>
						<TooltipContent className="max-w-56">
							{item.removeBlockedReason}
						</TooltipContent>
					</Tooltip>
				</>
			) : item.onRequestDelete ? (
				<>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={item.onRequestDelete} variant="destructive">
						<HugeiconsIcon className="size-4" icon={Delete01Icon} />
						Delete
					</ContextMenuItem>
				</>
			) : null}
		</>
	);
}
