/** One verified human's durable read marker for one conversation message. */
export interface MessageReadReceipt {
	messageId: string;
	readAt: string;
	userId: string;
	userName?: string;
}

/** Scoped display metadata for one receipt-bearing human. */
export interface MessageReadReceiptUser {
	avatar?: string;
	id: string;
	name: string;
}

/** Merge receipt rows without double-counting duplicate realtime or HTTP data. */
export function mergeReadReceipts(
	current: readonly MessageReadReceipt[],
	next: readonly MessageReadReceipt[]
): MessageReadReceipt[] {
	const byKey = new Map<string, MessageReadReceipt>();
	for (const receipt of [...current, ...next]) {
		const key = `${receipt.messageId}\u0000${receipt.userId}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, receipt);
			continue;
		}
		// The first durable marker wins. A duplicate event may carry a display
		// name that the initial snapshot did not, so enrich the existing row
		// without changing its read time.
		if (!existing.userName && receipt.userName) {
			byKey.set(key, { ...existing, userName: receipt.userName });
		}
	}
	return [...byKey.values()].sort((a, b) => {
		const byTime = a.readAt.localeCompare(b.readAt);
		if (byTime !== 0) {
			return byTime;
		}
		return `${a.messageId}:${a.userId}`.localeCompare(
			`${b.messageId}:${b.userId}`
		);
	});
}

/** Decode an untrusted realtime read-receipt frame for the active room. */
export function readReceiptFromFrame(
	data: unknown,
	conversationId: string | null
): MessageReadReceipt | null {
	if (typeof data !== "object" || data === null) {
		return null;
	}
	const frame = data as Record<string, unknown>;
	if (frame.type !== "readReceipt" && frame.type !== "read_receipt") {
		return null;
	}
	const frameConversationId =
		typeof frame.conversationId === "string"
			? frame.conversationId
			: typeof frame.conversation_id === "string"
				? frame.conversation_id
				: null;
	if (conversationId && frameConversationId !== conversationId) {
		return null;
	}
	const messageId =
		typeof frame.messageId === "string"
			? frame.messageId.trim()
			: typeof frame.message_id === "string"
				? frame.message_id.trim()
				: "";
	const userId =
		typeof frame.userId === "string"
			? frame.userId.trim()
			: typeof frame.user_id === "string"
				? frame.user_id.trim()
				: "";
	const readAt =
		typeof frame.readAt === "string"
			? frame.readAt.trim()
			: typeof frame.read_at === "string"
				? frame.read_at.trim()
				: "";
	if (!(messageId && userId && readAt)) {
		return null;
	}
	const userName =
		typeof frame.userName === "string"
			? frame.userName.trim()
			: typeof frame.user_name === "string"
				? frame.user_name.trim()
				: "";
	return {
		messageId,
		readAt,
		userId,
		...(userName ? { userName } : {}),
	};
}
