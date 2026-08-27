import {
	BACKEND_URL,
	getActiveUserId,
	listAccounts,
} from "@/lib/auth-client.ts";
import { type ApiTarget, request } from "./client.ts";

export type ConversationAccessRole = "participant" | "viewer";
export type ConversationVisibility = "org" | "private" | "team";

export interface ConversationCollaborator {
	role: ConversationAccessRole;
	user_id: string;
}

export interface ConversationAccess {
	can_manage: boolean;
	collaborators: ConversationCollaborator[];
	owner_user_id: string | null;
	team_id: string | null;
	visibility: ConversationVisibility;
}

export interface PrincipalDirectory {
	members: Array<{ email: string | null; id: string; name: string }>;
	org_id?: string | null;
	teams: Array<{ id: string; name: string }>;
}

export interface PublicShareStatus {
	created_at: number;
	updated_at: number;
	url: string;
}

export interface PublicSnapshotMessage {
	content: string;
	created_at: number;
	id: string;
	role: "assistant" | "user";
}

interface CoreConversationDetail {
	messages?: Array<{
		content?: unknown;
		created_at?: unknown;
		id?: unknown;
		role?: unknown;
	}>;
}

interface PublicShareResponse {
	share: PublicShareStatus | null;
}

function activeBearer(): string {
	const activeUserId = getActiveUserId();
	const account = listAccounts().find(
		(candidate) => candidate.userId === activeUserId
	);
	if (!account?.token) {
		throw new Error("Sign in to publish a public link.");
	}
	return account.token;
}

async function controlPlaneRequest<T>(
	path: string,
	options: { body?: unknown; method?: string } = {}
): Promise<T> {
	const response = await fetch(`${BACKEND_URL}${path}`, {
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		headers: {
			Authorization: `Bearer ${activeBearer()}`,
			"Content-Type": "application/json",
		},
		method: options.method ?? "GET",
		signal: AbortSignal.timeout(15_000),
	});
	const body = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		const message =
			body && typeof body === "object" && "message" in body
				? String(body.message)
				: `Sharing request failed (${response.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function getConversationAccess(
	target: ApiTarget,
	conversationId: string
): Promise<ConversationAccess> {
	return request(
		target,
		`/api/conversations/${encodeURIComponent(conversationId)}/access`
	);
}

export function setConversationAccess(
	target: ApiTarget,
	conversationId: string,
	access: Pick<ConversationAccess, "collaborators" | "team_id" | "visibility">
): Promise<ConversationAccess & { ok: boolean }> {
	return request(
		target,
		`/api/conversations/${encodeURIComponent(conversationId)}/access`,
		{ method: "PUT", body: access }
	);
}

export function getPrincipalDirectory(
	target: ApiTarget
): Promise<PrincipalDirectory> {
	return request(target, "/api/acl/principals");
}

/** Read a fresh, full transcript and reduce it to the public snapshot schema. */
export async function getPublicSnapshotMessages(
	target: ApiTarget,
	conversationId: string
): Promise<PublicSnapshotMessage[]> {
	const detail = await request<CoreConversationDetail>(
		target,
		`/api/conversations/${encodeURIComponent(conversationId)}`
	);
	return (detail.messages ?? [])
		.flatMap((message): PublicSnapshotMessage[] => {
			if (
				(message.role !== "user" && message.role !== "assistant") ||
				typeof message.id !== "string" ||
				typeof message.content !== "string" ||
				typeof message.created_at !== "number"
			) {
				return [];
			}
			return [
				{
					content: message.content,
					created_at: message.created_at,
					id: message.id,
					role: message.role,
				},
			];
		})
		.slice(-500);
}

export async function getPublicShare(
	conversationId: string
): Promise<PublicShareStatus | null> {
	const response = await controlPlaneRequest<PublicShareResponse>(
		`/api/conversation-shares/conversation/${encodeURIComponent(conversationId)}`
	);
	return response.share;
}

export async function publishPublicShare(
	conversationId: string,
	title: string,
	messages: PublicSnapshotMessage[]
): Promise<PublicShareStatus> {
	const response = await controlPlaneRequest<PublicShareResponse>(
		`/api/conversation-shares/conversation/${encodeURIComponent(conversationId)}`,
		{ body: { messages, title }, method: "PUT" }
	);
	if (!response.share) {
		throw new Error("The share link was not returned.");
	}
	return response.share;
}

export async function revokePublicShare(conversationId: string): Promise<void> {
	await controlPlaneRequest<{ ok: boolean }>(
		`/api/conversation-shares/conversation/${encodeURIComponent(conversationId)}`,
		{ method: "DELETE" }
	);
}
