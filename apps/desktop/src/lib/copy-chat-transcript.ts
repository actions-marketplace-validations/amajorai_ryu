import { toast } from "@ryu/ui/components/sileo";

/** Minimal message shape accepted by the transcript formatter. */
export interface TranscriptMessage {
	content?: string;
	createdAt?: Date | string;
	metadata?: {
		author?: {
			id?: string;
			name?: string;
		};
	};
	parts?: unknown[];
	role: string;
	/** Alternative timestamp field used by the Message type. */
	timestamp?: number;
}

/** Options for formatting the transcript. */
export interface TranscriptOptions {
	/** Default user name to use when message metadata doesn't have author info. */
	defaultUserName?: string;
}

function textFromMessage(message: TranscriptMessage): string {
	if (Array.isArray(message.parts) && message.parts.length > 0) {
		return message.parts
			.filter(
				(part): part is { type: string; text?: string } =>
					typeof part === "object" &&
					part !== null &&
					(part as { type?: string }).type === "text" &&
					typeof (part as { text?: string }).text === "string"
			)
			.map((part) => part.text ?? "")
			.join("\n\n")
			.trim();
	}
	return typeof message.content === "string" ? message.content.trim() : "";
}

function formatTimestampForTranscript(date: Date): string {
	const day = date.getDate();
	const month = date.getMonth() + 1;
	const year = date.getFullYear();
	const hours = date.getHours();
	const minutes = date.getMinutes();
	const ampm = hours >= 12 ? "pm" : "am";
	const displayHours = hours % 12 || 12;
	const displayMinutes = minutes.toString().padStart(2, "0");
	return `${day}/${month}/${year}, ${displayHours}:${displayMinutes} ${ampm}`;
}

function getAuthorLabel(
	message: TranscriptMessage,
	defaultUserName?: string
): string {
	if (message.role === "assistant") {
		return "Assistant";
	}
	if (message.role === "user") {
		const author = message.metadata?.author;
		const name = author?.name || author?.id;
		if (name) {
			return name;
		}
		return defaultUserName || "User";
	}
	return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

/** Format user/assistant turns as plain text for the clipboard. */
export function formatChatTranscript(
	messages: TranscriptMessage[],
	options?: TranscriptOptions
): string {
	const blocks: string[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}
		const text = textFromMessage(message);
		if (!text) {
			continue;
		}
		const authorLabel = getAuthorLabel(message, options?.defaultUserName);
		const createdAt = message.createdAt
			? new Date(message.createdAt)
			: message.timestamp
				? new Date(message.timestamp)
				: null;
		const timestamp = createdAt
			? `, [${formatTimestampForTranscript(createdAt)}]`
			: "";
		blocks.push(`${authorLabel}${timestamp}:\n${text}`);
	}
	return blocks.join("\n\n");
}

/**
 * Copy a chat transcript to the clipboard and toast the result.
 * Accepts either an already-loaded message list or an async loader.
 */
export async function copyChatTranscript(
	source: TranscriptMessage[] | (() => Promise<TranscriptMessage[]>),
	options?: TranscriptOptions
): Promise<void> {
	try {
		const messages = typeof source === "function" ? await source() : source;
		const transcript = formatChatTranscript(messages, options);
		if (!transcript) {
			toast.info("Nothing to copy");
			return;
		}
		await navigator.clipboard.writeText(transcript);
		toast.success("Copied to clipboard");
	} catch {
		toast.error("Couldn't copy transcript");
	}
}
