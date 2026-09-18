import { create } from "zustand";

export interface QuickReplyRequest {
	conversationId: string;
	targetUrl: string;
	title: string;
}

type QuickReplySubmitter = (content: string) => void | Promise<void>;

interface PendingQuickReply {
	content: string;
	key: string;
}

interface RegisteredQuickReplyHandler {
	owner: symbol;
	submit: QuickReplySubmitter;
}

interface QuickReplyState {
	close: () => void;
	open: (request: QuickReplyRequest) => void;
	pending: PendingQuickReply[];
	registerHandler: (
		targetUrl: string,
		conversationId: string,
		submit: QuickReplySubmitter
	) => () => void;
	request: QuickReplyRequest | null;
	submit: (
		targetUrl: string,
		conversationId: string,
		content: string
	) => "queued" | "sent";
}

const handlers = new Map<string, RegisteredQuickReplyHandler>();

function handlerKey(targetUrl: string, conversationId: string): string {
	return `${targetUrl}\u0000${conversationId}`;
}

function dispatch(handler: QuickReplySubmitter, content: string): void {
	void Promise.resolve(handler(content)).catch(() => undefined);
}

export const useQuickReplyStore = create<QuickReplyState>((set, get) => ({
	close: () => set({ request: null }),
	open: (request) => set({ request }),
	pending: [],
	registerHandler: (targetUrl, conversationId, submit) => {
		const key = handlerKey(targetUrl, conversationId);
		const owner = Symbol(key);
		handlers.set(key, { owner, submit });

		const pending = get().pending.filter((item) => item.key === key);
		if (pending.length > 0) {
			set((state) => ({
				pending: state.pending.filter((item) => item.key !== key),
			}));
			for (const item of pending) {
				dispatch(submit, item.content);
			}
		}

		return () => {
			if (handlers.get(key)?.owner === owner) {
				handlers.delete(key);
			}
		};
	},
	request: null,
	submit: (targetUrl, conversationId, content) => {
		const key = handlerKey(targetUrl, conversationId);
		const handler = handlers.get(key);
		if (handler) {
			dispatch(handler.submit, content);
			return "sent";
		}
		set((state) => ({
			pending: [...state.pending, { content, key }],
		}));
		return "queued";
	},
}));
