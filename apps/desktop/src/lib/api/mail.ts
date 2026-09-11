// apps/desktop/src/lib/api/mail.ts
// Node-scoped Agent Mail client. Core owns authentication and the sidecar owns
// mail storage; this module keeps the desktop and Companion contracts typed.

import { type ApiTarget, request } from "./client.ts";

export type InboxProvider = "webhook" | "imap";

export interface Inbox {
	address: string;
	client_id?: string | null;
	created_at: string;
	description?: string | null;
	id: string;
	metadata?: Record<string, unknown>;
	name: string;
	pod_id?: string | null;
	provider: InboxProvider;
	updated_at?: string;
}

export interface AttachmentMeta {
	content_id?: string | null;
	content_type: string;
	filename: string;
	id: string;
	inline?: boolean;
	size: number;
}

export interface EmailMessage {
	attachments: AttachmentMeta[];
	bcc_addrs: string[];
	cc_addrs: string[];
	client_id?: string | null;
	created_at: string;
	direction: string;
	error?: string | null;
	extracted_html?: string | null;
	extracted_text?: string | null;
	from_addr: string;
	headers?: Record<string, string>;
	html?: string;
	id: string;
	in_reply_to?: string;
	inbox_id: string;
	labels?: string[];
	message_id: string;
	opened_at?: string | null;
	preview?: string | null;
	provider_message_id?: string;
	read?: boolean;
	references?: string[];
	reply_to_addrs?: string[];
	status?: string;
	subject: string;
	text?: string;
	thread_id?: string | null;
	to_addrs: string[];
	updated_at?: string;
}

export interface AttachmentInput {
	content?: string;
	content_base64?: string;
	content_id?: string;
	content_type: string;
	filename: string;
	inline?: boolean;
}

export interface MailStatus {
	configured: boolean;
	domainMode: "byo" | "managed" | string;
	inbound: "webhook" | "imap" | "sns" | string;
	inboxCount: number;
	sendConfigured: boolean;
}

export interface CreateInboxInput {
	address: string;
	client_id?: string;
	metadata?: Record<string, unknown>;
	name: string;
	pod_id?: string;
	provider?: InboxProvider;
}

export interface SendInput {
	attachments?: AttachmentInput[];
	bcc?: string[];
	cc?: string[];
	clientId?: string;
	headers?: Record<string, string>;
	html?: string;
	inReplyTo?: string;
	labels?: string[];
	references?: string;
	replyTo?: string[];
	subject: string;
	text?: string;
	to: string[];
	trackOpens?: boolean;
}

export interface MailDraft {
	attachments: AttachmentMeta[];
	bcc_addrs: string[];
	cc_addrs: string[];
	client_id?: string | null;
	created_at: string;
	headers: Record<string, string>;
	html?: string;
	id: string;
	inbox_id: string;
	labels: string[];
	reply_to_addrs: string[];
	send_at?: string | null;
	status: string;
	subject: string;
	text?: string;
	thread_id?: string | null;
	to_addrs: string[];
	updated_at: string;
}

export interface MailWebhook {
	client_id?: string | null;
	created_at: string;
	enabled: boolean;
	event_types: string[];
	header_names: string[];
	inbox_ids: string[];
	pod_ids: string[];
	updated_at: string;
	url: string;
	webhook_id: string;
}

export interface MailEvent {
	created_at: string;
	event_id: string;
	event_type: string;
	inbox_id?: string | null;
	message_id?: string | null;
	payload: Record<string, unknown>;
}

export interface MailRequestInput {
	body?: unknown;
	method?: "DELETE" | "GET" | "PATCH" | "POST";
	path: string;
}

export interface MailThread {
	id: string;
	latest_message?: EmailMessage | null;
	message_count: number;
	participants: string[];
	subject?: string | null;
}

function unwrap<T>(value: unknown, key: string): T {
	if (typeof value === "object" && value !== null && key in value) {
		return (value as Record<string, unknown>)[key] as T;
	}
	return value as T;
}

function queryString(query: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "") {
			continue;
		}
		params.set(key, Array.isArray(value) ? value.join(",") : String(value));
	}
	return params.size ? `?${params}` : "";
}

export function getMailStatus(target: ApiTarget): Promise<MailStatus> {
	return request<MailStatus>(target, "/api/mail/status");
}

export async function listInboxes(target: ApiTarget): Promise<Inbox[]> {
	return unwrap<Inbox[]>(await request(target, "/api/mail/inboxes"), "inboxes");
}

export async function getInbox(target: ApiTarget, id: string): Promise<Inbox> {
	return unwrap<Inbox>(
		await request(target, `/api/mail/inboxes/${id}`),
		"inbox"
	);
}

export async function createInbox(
	target: ApiTarget,
	body: CreateInboxInput
): Promise<Inbox> {
	return unwrap<Inbox>(
		await request(target, "/api/mail/inboxes", { method: "POST", body }),
		"inbox"
	);
}

export async function renameInbox(
	target: ApiTarget,
	id: string,
	name: string
): Promise<Inbox> {
	return unwrap<Inbox>(
		await request(target, `/api/mail/inboxes/${id}`, {
			method: "PATCH",
			body: { name },
		}),
		"inbox"
	);
}

export async function rotateInboundSecret(
	target: ApiTarget,
	id: string
): Promise<string> {
	const response = await request<{
		inboundSecret?: string;
		inbound_secret?: string;
	}>(target, `/api/mail/inboxes/${id}/rotate-secret`, { method: "POST" });
	return response.inboundSecret ?? response.inbound_secret ?? "";
}

export async function deleteInbox(
	target: ApiTarget,
	id: string
): Promise<void> {
	await request(target, `/api/mail/inboxes/${id}`, { method: "DELETE" });
}

export async function listMessages(
	target: ApiTarget,
	inboxId: string,
	query: Record<string, unknown> = {}
): Promise<EmailMessage[]> {
	return unwrap<EmailMessage[]>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/messages${queryString(query)}`
		),
		"messages"
	);
}

export async function searchMessages(
	target: ApiTarget,
	inboxId: string,
	q: string,
	query: Record<string, unknown> = {}
): Promise<EmailMessage[]> {
	return listMessages(target, inboxId, { ...query, q });
}

export async function getMessage(
	target: ApiTarget,
	id: string
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(target, `/api/mail/messages/${id}`),
		"message"
	);
}

export async function updateMessage(
	target: ApiTarget,
	inboxId: string,
	messageId: string,
	body: {
		addLabels?: string[];
		labels?: string[];
		read?: boolean;
		removeLabels?: string[];
	}
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/messages/${messageId}`,
			{ method: "PATCH", body }
		),
		"message"
	);
}

export async function deleteMessage(
	target: ApiTarget,
	inboxId: string,
	messageId: string
): Promise<void> {
	await request(target, `/api/mail/inboxes/${inboxId}/messages/${messageId}`, {
		method: "DELETE",
	});
}

export async function sendMessage(
	target: ApiTarget,
	inboxId: string,
	body: SendInput,
	idempotencyKey?: string
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(target, `/api/mail/inboxes/${inboxId}/send`, {
			method: "POST",
			body,
			headers: idempotencyKey
				? { "Idempotency-Key": idempotencyKey }
				: undefined,
		}),
		"message"
	);
}

export async function replyMessage(
	target: ApiTarget,
	inboxId: string,
	messageId: string,
	body: Partial<SendInput> = {}
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/messages/${messageId}/reply`,
			{ method: "POST", body }
		),
		"message"
	);
}

export async function replyAllMessage(
	target: ApiTarget,
	inboxId: string,
	messageId: string,
	body: Partial<SendInput> = {}
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/messages/${messageId}/reply-all`,
			{ method: "POST", body }
		),
		"message"
	);
}

export async function forwardMessage(
	target: ApiTarget,
	inboxId: string,
	messageId: string,
	body: SendInput
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/messages/${messageId}/forward`,
			{ method: "POST", body }
		),
		"message"
	);
}

export async function listThreads(
	target: ApiTarget,
	inboxId: string,
	search?: string
): Promise<MailThread[]> {
	const path = search
		? `/api/mail/inboxes/${inboxId}/threads/search?q=${encodeURIComponent(search)}`
		: `/api/mail/inboxes/${inboxId}/threads`;
	const response = await request<{ threads: MailThread[] }>(target, path);
	return response.threads;
}

export async function getThread(
	target: ApiTarget,
	inboxId: string,
	threadId: string
): Promise<EmailMessage[]> {
	const response = await request<{ messages: EmailMessage[] }>(
		target,
		`/api/mail/inboxes/${inboxId}/threads/${threadId}`
	);
	return response.messages;
}

export async function listDrafts(
	target: ApiTarget,
	inboxId: string
): Promise<MailDraft[]> {
	const response = await request<{ drafts: MailDraft[] }>(
		target,
		`/api/mail/inboxes/${inboxId}/drafts`
	);
	return response.drafts;
}

export async function createDraft(
	target: ApiTarget,
	inboxId: string,
	body: Record<string, unknown>
): Promise<MailDraft> {
	return request<MailDraft>(target, `/api/mail/inboxes/${inboxId}/drafts`, {
		method: "POST",
		body,
	});
}

export async function updateDraft(
	target: ApiTarget,
	inboxId: string,
	draftId: string,
	body: Record<string, unknown>
): Promise<MailDraft> {
	return request<MailDraft>(
		target,
		`/api/mail/inboxes/${inboxId}/drafts/${draftId}`,
		{ method: "PATCH", body }
	);
}

export async function deleteDraft(
	target: ApiTarget,
	inboxId: string,
	draftId: string
): Promise<void> {
	await request(target, `/api/mail/inboxes/${inboxId}/drafts/${draftId}`, {
		method: "DELETE",
	});
}

export async function sendDraft(
	target: ApiTarget,
	inboxId: string,
	draftId: string,
	idempotencyKey?: string
): Promise<EmailMessage> {
	return unwrap<EmailMessage>(
		await request(
			target,
			`/api/mail/inboxes/${inboxId}/drafts/${draftId}/send`,
			{
				method: "POST",
				headers: idempotencyKey
					? { "Idempotency-Key": idempotencyKey }
					: undefined,
			}
		),
		"message"
	);
}

export async function listWebhooks(target: ApiTarget): Promise<MailWebhook[]> {
	const response = await request<{ webhooks: MailWebhook[] }>(
		target,
		"/api/mail/webhooks"
	);
	return response.webhooks;
}

export async function createWebhook(
	target: ApiTarget,
	body: Record<string, unknown>,
	inboxId?: string
): Promise<{ secret?: string | null; webhook: MailWebhook }> {
	return request(
		target,
		inboxId ? `/api/mail/inboxes/${inboxId}/webhooks` : "/api/mail/webhooks",
		{ method: "POST", body }
	);
}

export async function updateWebhook(
	target: ApiTarget,
	id: string,
	body: Record<string, unknown>
): Promise<{ secret?: string | null; webhook: MailWebhook }> {
	return request(target, `/api/mail/webhooks/${id}`, { method: "PATCH", body });
}

export async function deleteWebhook(
	target: ApiTarget,
	id: string
): Promise<void> {
	await request(target, `/api/mail/webhooks/${id}`, { method: "DELETE" });
}

export async function listWebhookHeaders(
	target: ApiTarget,
	id: string
): Promise<string[]> {
	const response = await request<{
		header_names?: string[];
		headers?: string[];
	}>(target, `/api/mail/webhooks/${id}/headers`);
	return response.header_names ?? response.headers ?? [];
}

export async function updateWebhookHeaders(
	target: ApiTarget,
	id: string,
	headers: Record<string, string>
): Promise<string[]> {
	const response = await request<{
		header_names?: string[];
		headers?: string[];
	}>(target, `/api/mail/webhooks/${id}/headers`, {
		method: "PATCH",
		body: { headers },
	});
	return response.header_names ?? response.headers ?? [];
}

export async function listEvents(
	target: ApiTarget,
	inboxId?: string
): Promise<MailEvent[]> {
	const response = await request<{ events: MailEvent[] }>(
		target,
		inboxId ? `/api/mail/inboxes/${inboxId}/events` : "/api/mail/events"
	);
	return response.events;
}

export async function downloadAttachment(
	target: ApiTarget,
	attachmentId: string
): Promise<{ url: string }> {
	return request(target, `/api/mail/attachments/${attachmentId}`);
}

export async function mailRequest(
	target: ApiTarget,
	input: MailRequestInput
): Promise<unknown> {
	return request(target, input.path, {
		method: input.method ?? "GET",
		body: input.body,
	});
}
