import { toast } from "@ryu/ui/components/sileo";

/** Minimal message shape accepted by the transcript formatter. */
export interface TranscriptMessage {
	content?: string;
	parts?: unknown[];
	role: string;
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

function roleLabel(role: string): string {
	if (role === "assistant") {
		return "Assistant";
	}
	if (role === "user") {
		return "User";
	}
	return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Format user/assistant turns as plain text for the clipboard. */
export function formatChatTranscript(messages: TranscriptMessage[]): string {
	const blocks: string[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}
		const text = textFromMessage(message);
		if (!text) {
			continue;
		}
		blocks.push(`${roleLabel(message.role)}:\n${text}`);
	}
	return blocks.join("\n\n");
}

/**
 * Copy a chat transcript to the clipboard and toast the result.
 * Accepts either an already-loaded message list or an async loader.
 */
export async function copyChatTranscript(
	source: TranscriptMessage[] | (() => Promise<TranscriptMessage[]>)
): Promise<void> {
	try {
		const messages = typeof source === "function" ? await source() : source;
		const transcript = formatChatTranscript(messages);
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
