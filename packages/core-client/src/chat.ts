// apps/desktop/src/lib/api/chat.ts
//
// Typed client for Core's chat streaming endpoint (`/api/chat/stream`). The chat
// page drives an AI SDK `useChat` transport, so rather than owning the fetch this
// module exposes the endpoint URL + auth headers the transport needs. Centralizing
// it here keeps base-URL + bearer handling out of the page.

import { type ApiTarget, apiUrl, makeHeaders, request } from "./client.ts";

/** Absolute URL of the streaming chat endpoint for a given node. */
export function chatStreamUrl(target: ApiTarget): string {
	return apiUrl(target, "/api/chat/stream");
}

/** Auth headers (bearer token when present) for the chat transport. */
export function chatHeaders(target: ApiTarget): Record<string, string> {
	const headers = makeHeaders(target.token);
	// The AI SDK transport sets its own content-type per request; only the
	// Authorization header needs to be carried here.
	const auth: Record<string, string> = {};
	if (headers.Authorization) {
		auth.Authorization = headers.Authorization;
	}
	return auth;
}

/** URL for reconnecting to an active ACP turn's replay/live stream. */
export function chatStreamResumeUrl(
	target: ApiTarget,
	conversationId: string
): string {
	return apiUrl(
		target,
		`/api/chat/stream/resume/${encodeURIComponent(conversationId)}`
	);
}

/** Cancel a live chat turn. Aborting the client stream alone does not stop Core. */
export async function cancelChat(
	target: ApiTarget,
	conversationId: string
): Promise<boolean> {
	const response = await request<{ cancelled: boolean }>(
		target,
		"/api/chat/cancel",
		{ method: "POST", body: { conversation_id: conversationId } }
	);
	return response.cancelled;
}

/** Fetch post-turn prompt suggestions; failures intentionally degrade to no chips. */
export async function fetchNextPromptSuggestions(
	target: ApiTarget,
	conversationId: string,
	signal?: AbortSignal
): Promise<string[]> {
	try {
		const response = await request<{ suggestions?: string[] }>(
			target,
			"/api/chat/suggestions",
			{
				method: "POST",
				body: { conversation_id: conversationId },
				signal,
			}
		);
		return response.suggestions ?? [];
	} catch {
		return [];
	}
}
