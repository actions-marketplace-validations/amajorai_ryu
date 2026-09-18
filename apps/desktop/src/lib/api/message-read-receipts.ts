// Typed client for durable per-human conversation read markers.
//
// Read markers are separate from the conversation message payload: one bulk
// snapshot restores the Instagram-style avatar indicators, while the bounded
// POST lets a viewport acknowledge several visible messages in one request.

import type {
	MessageReadReceipt,
	MessageReadReceiptUser,
} from "../read-receipts.ts";
import { type ApiTarget, request } from "./client.ts";

interface ReadReceiptWire {
	messageId?: unknown;
	readAt?: unknown;
	userId?: unknown;
	userName?: unknown;
}

interface ReadReceiptUserWire {
	avatar?: unknown;
	id?: unknown;
	name?: unknown;
}

export interface MessageReadReceiptsSnapshot {
	receipts: MessageReadReceipt[];
	users: MessageReadReceiptUser[];
}

function receiptFromWire(raw: ReadReceiptWire): MessageReadReceipt | null {
	const messageId =
		typeof raw.messageId === "string" ? raw.messageId.trim() : "";
	const userId = typeof raw.userId === "string" ? raw.userId.trim() : "";
	const readAt = typeof raw.readAt === "string" ? raw.readAt.trim() : "";
	if (!(messageId && userId && readAt)) {
		return null;
	}
	const userName = typeof raw.userName === "string" ? raw.userName.trim() : "";
	return {
		messageId,
		readAt,
		userId,
		...(userName ? { userName } : {}),
	};
}

function userFromWire(raw: ReadReceiptUserWire): MessageReadReceiptUser | null {
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!id) {
		return null;
	}
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	return {
		avatar:
			typeof raw.avatar === "string"
				? raw.avatar.trim() || undefined
				: undefined,
		id,
		name: name || id,
	};
}

/** Load every read marker and its scoped display metadata for one conversation. */
export async function listMessageReadReceipts(
	target: ApiTarget,
	conversationId: string
): Promise<MessageReadReceiptsSnapshot> {
	const body = await request<{
		receipts?: ReadReceiptWire[];
		users?: ReadReceiptUserWire[];
	}>(
		target,
		`/api/conversations/${encodeURIComponent(conversationId)}/read-receipts`
	);
	return {
		receipts: (body.receipts ?? []).flatMap((receipt) => {
			const normalized = receiptFromWire(receipt);
			return normalized ? [normalized] : [];
		}),
		users: (body.users ?? []).flatMap((user) => {
			const normalized = userFromWire(user);
			return normalized ? [normalized] : [];
		}),
	};
}

/** Mark visible messages read as the authenticated caller. */
export async function markMessageRead(
	target: ApiTarget,
	conversationId: string,
	messageIds: readonly string[]
): Promise<MessageReadReceipt[]> {
	const body = await request<{ receipts?: ReadReceiptWire[] }>(
		target,
		`/api/conversations/${encodeURIComponent(conversationId)}/read`,
		{
			body: { messageIds: [...new Set(messageIds)] },
			method: "POST",
		}
	);
	return (body.receipts ?? []).flatMap((receipt) => {
		const normalized = receiptFromWire(receipt);
		return normalized ? [normalized] : [];
	});
}
