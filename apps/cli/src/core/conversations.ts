import { type ApiTarget, apiUrl, makeHeaders } from "@ryuhq/core-client/client";

interface ForkConversationResponse {
	conversation?: { id?: unknown };
}

export interface ResumedConversationMessage {
	content: string;
	id: string;
	parts?: unknown;
	role: string;
}

export interface ResumedConversation {
	id: string;
	messages: ResumedConversationMessage[];
	title: string | null;
}

interface ConversationDetailResponse {
	id?: unknown;
	messages?: unknown;
	title?: unknown;
}

function conversationPath(conversationId: string): string {
	return `/api/conversations/${encodeURIComponent(conversationId)}`;
}

/** Load a persisted conversation so the TUI can resume it. */
export async function resumeConversation(
	target: ApiTarget,
	conversationId: string
): Promise<ResumedConversation> {
	const response = await fetch(
		apiUrl(target, conversationPath(conversationId)),
		{
			headers: makeHeaders(target.token),
		}
	);
	if (!response.ok) {
		throw new Error(`Resume conversation failed: ${response.status}`);
	}
	const body = (await response.json()) as ConversationDetailResponse;
	if (
		typeof body.id !== "string" ||
		!Array.isArray(body.messages) ||
		!body.messages.every((message) => {
			if (message === null || typeof message !== "object") {
				return false;
			}
			const item = message as Record<string, unknown>;
			return (
				typeof item.id === "string" &&
				typeof item.role === "string" &&
				typeof item.content === "string"
			);
		})
	) {
		throw new Error("Resume conversation returned an invalid conversation");
	}
	return {
		id: body.id,
		title: typeof body.title === "string" ? body.title : null,
		messages: body.messages.map((message) => {
			const item = message as Record<string, unknown>;
			return {
				id: item.id as string,
				role: item.role as string,
				content: item.content as string,
				parts: item.parts,
			};
		}),
	};
}

/** Rename a persisted conversation using Core's user-title endpoint. */
export async function renameConversation(
	target: ApiTarget,
	conversationId: string,
	title: string
): Promise<string> {
	const normalizedTitle = title.trim();
	if (normalizedTitle.length === 0) {
		throw new Error("Conversation title must not be empty");
	}
	const response = await fetch(
		apiUrl(target, `${conversationPath(conversationId)}/title`),
		{
			method: "POST",
			headers: {
				...makeHeaders(target.token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title: normalizedTitle }),
		}
	);
	if (!response.ok) {
		throw new Error(`Rename conversation failed: ${response.status}`);
	}
	const body = (await response.json()) as { title?: unknown };
	if (typeof body.title !== "string" || body.title.length === 0) {
		throw new Error("Rename conversation returned no title");
	}
	return body.title;
}

/** Permanently delete a conversation through Core. */
export async function deleteConversation(
	target: ApiTarget,
	conversationId: string
): Promise<boolean> {
	const response = await fetch(
		apiUrl(target, conversationPath(conversationId)),
		{
			method: "DELETE",
			headers: makeHeaders(target.token),
		}
	);
	if (!response.ok) {
		throw new Error(`Delete conversation failed: ${response.status}`);
	}
	const body = (await response.json()) as { removed?: unknown };
	return body.removed === true;
}

/** Set the server-backed pinned state for a conversation. */
export async function setConversationPinned(
	target: ApiTarget,
	conversationId: string,
	pinned: boolean
): Promise<void> {
	const response = await fetch(
		apiUrl(
			target,
			`/api/conversations/${encodeURIComponent(conversationId)}/pinned`
		),
		{
			method: "POST",
			headers: {
				...makeHeaders(target.token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ value: pinned }),
		}
	);
	if (!response.ok) {
		throw new Error(
			`${pinned ? "Pin" : "Unpin"} conversation failed: ${response.status}`
		);
	}
}

/**
 * Fork a conversation on Core. Omitting messageId copies the whole history;
 * Core accepts a message id when the caller wants a branch at a specific turn.
 */
export async function forkConversation(
	target: ApiTarget,
	conversationId: string,
	messageId?: string
): Promise<string> {
	const response = await fetch(
		apiUrl(
			target,
			`/api/conversations/${encodeURIComponent(conversationId)}/fork`
		),
		{
			method: "POST",
			headers: makeHeaders(target.token),
			body:
				messageId === undefined
					? undefined
					: JSON.stringify({ message_id: messageId }),
		}
	);
	if (!response.ok) {
		throw new Error(`Fork conversation failed: ${response.status}`);
	}
	const body = (await response.json()) as ForkConversationResponse;
	const forkedId = body.conversation?.id;
	if (typeof forkedId !== "string" || forkedId.length === 0) {
		throw new Error("Fork conversation returned no conversation id");
	}
	return forkedId;
}
