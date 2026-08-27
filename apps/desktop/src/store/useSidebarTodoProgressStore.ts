import { create } from "zustand";
import {
	deriveTodoProgress,
	type TodoProgressMessage,
	type TodoProgressSnapshot,
} from "@/src/lib/todo-progress.ts";

export interface SidebarTodoProgressEntry {
	progress: TodoProgressSnapshot | null;
	revision: number;
	status: "error" | "loading" | "ready";
}

export interface SidebarTodoProgressStore {
	entries: Record<string, SidebarTodoProgressEntry | undefined>;
	setEntry: (key: string, entry: SidebarTodoProgressEntry) => void;
}

export const useSidebarTodoProgressStore = create<SidebarTodoProgressStore>(
	(set) => ({
		entries: {},
		setEntry: (key, entry) =>
			set((state) => {
				const current = state.entries[key];
				if (current && current.revision > entry.revision) {
					return state;
				}
				return {
					entries: {
						...state.entries,
						[key]: entry,
					},
				};
			}),
	})
);

const inFlight = new Map<string, Promise<void>>();
const activeRequestTokens = new Map<string, symbol>();

export function sidebarTodoProgressKey(input: {
	conversationId: string;
	nodeUrl: string;
}): string {
	return JSON.stringify([input.nodeUrl, input.conversationId]);
}

export function publishSidebarTodoProgress(input: {
	key: string;
	messages: readonly TodoProgressMessage[];
	revision: number;
}): void {
	activeRequestTokens.delete(input.key);
	useSidebarTodoProgressStore.getState().setEntry(input.key, {
		progress: deriveTodoProgress(input.messages) ?? null,
		revision: input.revision,
		status: "ready",
	});
}

export function ensureSidebarTodoProgress(input: {
	conversationId: string;
	key: string;
	loadMessages: (
		conversationId: string
	) => Promise<readonly TodoProgressMessage[]>;
	revision: number;
}): Promise<void> {
	const requestKey = `${input.key}\u0000${input.revision}`;
	const pending = inFlight.get(requestKey);
	if (pending) {
		return pending;
	}

	const existing = useSidebarTodoProgressStore.getState().entries[input.key];
	if (existing && existing.revision > input.revision) {
		return Promise.resolve();
	}
	if (
		existing?.revision === input.revision &&
		(existing.status === "ready" || existing.status === "error")
	) {
		return Promise.resolve();
	}

	const token = Symbol(input.key);
	activeRequestTokens.set(input.key, token);
	useSidebarTodoProgressStore.getState().setEntry(input.key, {
		progress: null,
		revision: input.revision,
		status: "loading",
	});

	const operation = (async () => {
		try {
			const messages = await input.loadMessages(input.conversationId);
			if (activeRequestTokens.get(input.key) !== token) {
				return;
			}
			useSidebarTodoProgressStore.getState().setEntry(input.key, {
				progress: deriveTodoProgress(messages) ?? null,
				revision: input.revision,
				status: "ready",
			});
		} catch {
			if (activeRequestTokens.get(input.key) !== token) {
				return;
			}
			useSidebarTodoProgressStore.getState().setEntry(input.key, {
				progress: null,
				revision: input.revision,
				status: "error",
			});
		} finally {
			inFlight.delete(requestKey);
		}
	})();
	inFlight.set(requestKey, operation);
	return operation;
}
