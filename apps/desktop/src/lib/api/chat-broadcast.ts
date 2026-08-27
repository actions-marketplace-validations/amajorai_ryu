import {
	ApiError,
	type ApiTarget,
	apiUrl,
	readJsonBody,
	request,
	requestHeaders,
} from "./client.ts";

/** The summary the Chat Broadcast companion is allowed to render. */
export interface ChatBroadcastConversation {
	agent_id: string | null;
	archived?: boolean;
	created_at: number;
	id: string;
	last_message?: string;
	last_message_at?: number;
	last_message_role?: string;
	message_count: number;
	run_status: string | null;
	title: string | null;
	updated_at: number;
}

interface ChatBroadcastMessage {
	content: string;
	parts?: unknown[];
	role: string;
}

interface ChatBroadcastConversationDetail {
	agent_id: string | null;
	messages?: ChatBroadcastMessage[];
}

export interface ChatBroadcastSendInput {
	conversationId: string;
	text: string;
}

export interface ChatBroadcastSendResult {
	conversation_id: string;
	status: "accepted";
}

const CHAT_STREAM_PATH = "/api/chat/stream";

/** List every conversation visible to the signed-in user, including idle chats. */
export async function listChatBroadcastConversations(
	target: ApiTarget
): Promise<ChatBroadcastConversation[]> {
	const response = await request<{
		conversations?: ChatBroadcastConversation[];
	}>(target, "/api/conversations?preview=1");
	return Array.isArray(response.conversations) ? response.conversations : [];
}

/**
 * Append one real user turn to an existing conversation.
 *
 * Core's OpenAI-compatible route expects the client-held transcript, while ACP
 * uses the conversation id to continue its queued session. The trusted host
 * therefore loads the full transcript here, adds only the new text, and then
 * drops the SSE body after Core accepts it. Core keeps the completion task alive
 * after the client disconnects, so a broadcast does not need a visible stream
 * per target and the sandbox never receives assistant content.
 */
export async function sendChatBroadcastTurn(
	target: ApiTarget,
	input: ChatBroadcastSendInput
): Promise<ChatBroadcastSendResult> {
	const conversation = await request<ChatBroadcastConversationDetail>(
		target,
		`/api/conversations/${encodeURIComponent(input.conversationId)}`
	);
	const messages = (conversation.messages ?? []).map((message) => ({
		content: message.content,
		parts: Array.isArray(message.parts) ? message.parts : [],
		role: message.role === "assistant" ? "assistant" : "user",
	}));
	messages.push({
		content: input.text,
		parts: [],
		role: "user",
	});

	const response = await fetch(apiUrl(target, CHAT_STREAM_PATH), {
		body: JSON.stringify({
			agent_id: conversation.agent_id ?? undefined,
			conversation_id: input.conversationId,
			enable_long_term: false,
			messages,
			persist: true,
		}),
		headers: await requestHeaders(target),
		method: "POST",
	});
	if (!response.ok) {
		const body = await readJsonBody<unknown>(response, CHAT_STREAM_PATH);
		throw new ApiError(CHAT_STREAM_PATH, body.status, body.error ?? undefined);
	}

	// The Core completion task is deliberately detached from the SSE generator;
	// cancelling the body stops this host request without stopping the chat turn.
	await response.body?.cancel();
	return {
		conversation_id: input.conversationId,
		status: "accepted",
	};
}
