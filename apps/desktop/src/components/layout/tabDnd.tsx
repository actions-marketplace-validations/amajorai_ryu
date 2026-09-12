import { toast } from "@ryu/ui/components/sileo";
import {
	createContext,
	type DragEvent,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { moveTabToWindow } from "@/src/lib/move-tab-window.ts";
import {
	canTearOutTab,
	readTabTransfer,
	TabTransferBlockedError,
} from "@/src/lib/tab-transfer.ts";
import { invokeWhenReady, isTauriReady } from "@/src/lib/tauri-ready.ts";

/** Marker dataTransfer type so drop targets can tell a tab drag from an
    external drag (files, text) without reading the payload mid-drag. */
export const TAB_DRAG_MIME = "application/x-ryu-tab";
/** A chat tab's durable identity, copied into another chat as an @ reference. */
export const CHAT_REFERENCE_DRAG_MIME = "application/x-ryu-chat-reference";

// Drag state for a tab chip/row, shared by the title-bar strip, the vertical
// sidebar list, and the content-area split drop zones. `draggingId` is the tab
// being dragged; `overId`/`dropBefore` mark which strip tab is hovered and on
// which side the reorder indicator should draw. `canDrop` gates strip drops to
// tabs of the same pinned-state (pinned tabs reorder within their block,
// unpinned within theirs) since `normalize` would otherwise snap a cross-block
// drop back anyway.
export interface TabDnd {
	canDrop: (targetId: string) => boolean;
	draggingId: string | null;
	dropBefore: boolean;
	moveToWindow: (id: string, dragOut?: boolean) => Promise<void>;
	onDrop: (id: string) => void;
	onEnd: (event?: DragEvent) => void;
	onOver: (id: string, before: boolean) => void;
	onStart: (id: string) => void;
	overId: string | null;
}

const TabDndContext = createContext<TabDnd | null>(null);

export function useTabDnd(): TabDnd {
	const ctx = useContext(TabDndContext);
	if (!ctx) {
		throw new Error("useTabDnd must be used inside TabDndProvider");
	}
	return ctx;
}

/** Owns the drag state for every tab drag surface. Mounted once in Layout so
    the strip, the vertical tab list, and the split drop zones all see the same
    drag. */
export function TabDndProvider({ children }: { children: ReactNode }) {
	const { tabs, moveTab, removeFromSplit, closeTab } = useTabsContext();
	const activeDrag = useRef<string | null>(null);
	const dragRevision = useRef(0);
	const cancelled = useRef(false);
	const moving = useRef(new Set<string>());
	const currentTabs = useRef(tabs);
	currentTabs.current = tabs;
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);
	const [dropBefore, setDropBefore] = useState(true);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				cancelled.current = true;
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			activeDrag.current = null;
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, []);

	useEffect(() => {
		if (!readTabTransfer()) {
			return;
		}
		// Layout and its tab tree have committed. A source is never removed just
		// because the native process managed to allocate a blank window.
		const timer = setTimeout(() => {
			void invokeWhenReady("tab_transfer_ready").catch(() => {
				// The native timeout closes this unacknowledged destination and the
				// source reports the failure with its tab still intact.
			});
		});
		return () => clearTimeout(timer);
	}, []);

	const moveToWindow = async (id: string, dragOut = false) => {
		const tab = currentTabs.current.find((candidate) => candidate.id === id);
		if (!tab || moving.current.has(id) || !isTauriReady()) {
			return;
		}
		moving.current.add(id);
		try {
			const moved = await moveTabToWindow(tab, dragOut);
			const current = currentTabs.current.find(
				(candidate) => candidate.id === id
			);
			if (
				moved &&
				current?.path === tab.path &&
				current?.conversationId === tab.conversationId &&
				current?.navToken === tab.navToken
			) {
				closeTab(id, { transferred: true });
			}
		} catch (error) {
			console.error("Tab window transfer failed", error);
			toast.error(
				error instanceof TabTransferBlockedError
					? error.message
					: "Couldn't move this tab. It is still open in this window."
			);
		} finally {
			moving.current.delete(id);
		}
	};

	const canDrop = (targetId: string): boolean => {
		if (!draggingId || draggingId === targetId) {
			return false;
		}
		const dragged = tabs.find((t) => t.id === draggingId);
		const target = tabs.find((t) => t.id === targetId);
		// Keep pinned tabs reordering within the pinned block and unpinned within
		// theirs — a cross-block drop would just be snapped back by normalize.
		return (
			!!dragged &&
			!!target &&
			Boolean(dragged.pinned) === Boolean(target.pinned)
		);
	};

	const reset = () => {
		activeDrag.current = null;
		setDraggingId(null);
		setOverId(null);
	};

	const value: TabDnd = {
		draggingId,
		overId,
		dropBefore,
		onStart: (id) => {
			cancelled.current = false;
			activeDrag.current = id;
			setDraggingId(id);
			const revision = ++dragRevision.current;
			if (isTauriReady()) {
				void invokeWhenReady<boolean | null>("watch_tab_drag")
					.then((outside) => {
						if (outside === null) {
							return;
						}
						// Give dragend/drop handlers precedence, especially external chat
						// reference copies. Only recover an otherwise stranded native drag.
						setTimeout(() => {
							if (
								activeDrag.current !== id ||
								dragRevision.current !== revision
							) {
								return;
							}
							reset();
							if (outside && !cancelled.current) {
								void moveToWindow(id, true);
							}
						}, 150);
					})
					.catch(() => {
						/* Older native hosts keep their normal DOM drag path. */
					});
			}
		},
		onEnd: (event) => {
			const id = activeDrag.current;
			reset();
			if (
				id &&
				event &&
				canTearOutTab(
					event.dataTransfer.dropEffect,
					event.buttons,
					cancelled.current
				)
			) {
				void moveToWindow(id, true);
			}
		},
		moveToWindow,
		onOver: (id, before) => {
			setOverId((prev) => (prev === id ? prev : id));
			setDropBefore((prev) => (prev === before ? prev : before));
		},
		onDrop: (id) => {
			if (draggingId && canDrop(id)) {
				const dragged = tabs.find((t) => t.id === draggingId);
				const target = tabs.find((t) => t.id === id);
				moveTab(draggingId, id, dropBefore);
				// Dragging a pane's chip OUT of its split bracket (dropping on a tab
				// that isn't a sibling) pulls it out of the split — the drag-out-to-
				// unsplit gesture. Dropping between siblings just reorders the panes'
				// strip chips.
				if (dragged?.splitId && dragged.splitId !== target?.splitId) {
					removeFromSplit(draggingId);
				}
			}
			reset();
		},
		canDrop,
	};

	return (
		<TabDndContext.Provider value={value}>{children}</TabDndContext.Provider>
	);
}

/** Shared drag handlers + indicator flags for a single draggable tab chip/row.
    Keeps the dragstart/dragover/drop wiring in one place so the strip chips
    and the vertical rows stay in sync. `axis` picks which midpoint decides the
    before/after side: "x" for the horizontal strip, "y" for vertical rows. */
export function useTabDragProps(tabId: string, axis: "x" | "y" = "x") {
	const dnd = useTabDnd();
	const { tabs } = useTabsContext();
	const isDragging = dnd.draggingId === tabId;
	const isOver = dnd.overId === tabId && dnd.draggingId !== tabId;
	return {
		isDragging,
		showBefore: isOver && dnd.dropBefore,
		showAfter: isOver && !dnd.dropBefore,
		dragHandlers: {
			draggable: true,
			onDragStart: (e: DragEvent) => {
				e.dataTransfer.effectAllowed = "copyMove";
				e.dataTransfer.setData("text/plain", tabId);
				e.dataTransfer.setData(TAB_DRAG_MIME, tabId);
				const tab = tabs.find((candidate) => candidate.id === tabId);
				if (tab?.conversationId) {
					e.dataTransfer.setData(
						CHAT_REFERENCE_DRAG_MIME,
						JSON.stringify({ id: tab.conversationId, label: tab.title })
					);
				}
				dnd.onStart(tabId);
			},
			onDragEnd: (event: DragEvent) => dnd.onEnd(event),
			onDragOver: (e: DragEvent) => {
				if (
					!dnd.draggingId ||
					dnd.draggingId === tabId ||
					!dnd.canDrop(tabId)
				) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				const rect = e.currentTarget.getBoundingClientRect();
				dnd.onOver(
					tabId,
					axis === "x"
						? e.clientX < rect.left + rect.width / 2
						: e.clientY < rect.top + rect.height / 2
				);
			},
			onDrop: (e: DragEvent) => {
				if (!dnd.draggingId) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				dnd.onDrop(tabId);
			},
		},
	};
}
