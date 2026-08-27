import { useEffect } from "react";
import {
	deriveTodoProgress,
	type TodoProgressMessage,
	type TodoProgressSnapshot,
} from "@/src/lib/todo-progress.ts";
import {
	ensureSidebarTodoProgress,
	publishSidebarTodoProgress,
	sidebarTodoProgressKey,
	useSidebarTodoProgressStore,
} from "@/src/store/useSidebarTodoProgressStore.ts";

export interface UseSidebarTodoProgressOptions {
	conversationId?: string;
	loadMessages?: (
		conversationId: string
	) => Promise<readonly TodoProgressMessage[]>;
	messages?: readonly TodoProgressMessage[];
	nodeUrl: string;
	revision: number;
}

export function useSidebarTodoProgress({
	conversationId,
	loadMessages,
	messages,
	nodeUrl,
	revision,
}: UseSidebarTodoProgressOptions): TodoProgressSnapshot | null {
	const key = conversationId
		? sidebarTodoProgressKey({ conversationId, nodeUrl })
		: null;
	const entry = useSidebarTodoProgressStore((state) =>
		key ? state.entries[key] : undefined
	);
	// The Desktop is client-rendered, but this fallback keeps static browser
	// stories and server-side snapshots honest when a fixture publishes before
	// React's external-store server snapshot is read.
	const renderedEntry =
		entry ??
		(key ? useSidebarTodoProgressStore.getState().entries[key] : undefined);
	const hasLiveMessages = (messages?.length ?? 0) > 0;
	const liveProgress = hasLiveMessages
		? (deriveTodoProgress(messages ?? []) ?? null)
		: null;

	useEffect(() => {
		if (!(key && hasLiveMessages)) {
			return;
		}
		publishSidebarTodoProgress({
			key,
			messages: messages ?? [],
			revision,
		});
	}, [hasLiveMessages, key, messages, revision]);

	useEffect(() => {
		if (!(key && conversationId && loadMessages) || hasLiveMessages) {
			return;
		}
		void ensureSidebarTodoProgress({
			conversationId,
			key,
			loadMessages,
			revision,
		});
	}, [conversationId, hasLiveMessages, key, loadMessages, revision]);

	return hasLiveMessages ? liveProgress : (renderedEntry?.progress ?? null);
}
