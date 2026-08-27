/** The data part emitted when Core injects built-in memory into a chat turn. */
export const MEMORY_CITATIONS_PART = "data-ryu-memory-citations";

/** A durable memory fact that was actually included in the model context. */
export interface MemoryCitation {
	content: string;
	id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Read memory citations from a UIMessage's opaque parts without trusting the
 * wire shape. Malformed or duplicate entries are ignored so one bad provider
 * frame cannot break the message toolbar.
 */
export function extractMemoryCitations(
	parts: readonly unknown[] | undefined
): MemoryCitation[] {
	if (!parts) {
		return [];
	}

	const citations: MemoryCitation[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		if (!isRecord(part) || part.type !== MEMORY_CITATIONS_PART) {
			continue;
		}
		const data = part.data;
		if (!(isRecord(data) && Array.isArray(data.citations))) {
			continue;
		}
		for (const candidate of data.citations) {
			if (!isRecord(candidate)) {
				continue;
			}
			const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
			const content =
				typeof candidate.content === "string" ? candidate.content.trim() : "";
			if (!(id && content) || seen.has(id)) {
				continue;
			}
			seen.add(id);
			citations.push({ content, id });
		}
	}
	return citations;
}
