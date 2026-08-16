/**
 * Small client-side queue for prompts entered while a chat stream is active.
 * Core remains single-flight per conversation; the next prompt is submitted
 * only after the current stream has settled.
 */

export const MAX_QUEUED_CHAT_MESSAGES = 50;

export interface EnqueueResult {
	accepted: boolean;
	queue: string[];
}

export function enqueueChatMessage(
	queue: readonly string[],
	input: string
): EnqueueResult {
	const message = input.trim();
	if (message.length === 0 || queue.length >= MAX_QUEUED_CHAT_MESSAGES) {
		return { accepted: false, queue: [...queue] };
	}
	return { accepted: true, queue: [...queue, message] };
}

export interface DequeueResult {
	message: string | null;
	queue: string[];
}

export function dequeueChatMessage(queue: readonly string[]): DequeueResult {
	if (queue.length === 0) {
		return { message: null, queue: [] };
	}
	return { message: queue[0] ?? null, queue: queue.slice(1) };
}
