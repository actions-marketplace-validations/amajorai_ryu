import type { MentionItem } from "./types.ts";

const MENTION_END = /[\s<>()[\]{}"']/;

export interface MentionMatch {
	end: number;
	item?: MentionItem;
	token: string;
}

function isMentionStart(value: string, index: number): boolean {
	return index === 0 || /\s/.test(value[index - 1] ?? "");
}

function isMentionBoundary(value: string, index: number): boolean {
	const next = value[index];
	return next === undefined || MENTION_END.test(next) || /[.,;:!?]/.test(next);
}

export function findMentionAt(
	value: string,
	index: number,
	mentionItems: MentionItem[] | undefined
): MentionMatch | null {
	if (value[index] !== "@" || !isMentionStart(value, index)) {
		return null;
	}
	const tokenStart = index + 1;
	if (/^https?:\/\//i.test(value.slice(tokenStart))) {
		return null;
	}

	const candidates = (mentionItems ?? [])
		.flatMap((item) => [
			{ item, value: `@${item.label}` },
			...(item.id ? [{ item, value: `@${item.id}` }] : []),
		])
		.sort((left, right) => right.value.length - left.value.length);
	const resolved = candidates.find(
		(candidate) =>
			value.startsWith(candidate.value, index) &&
			isMentionBoundary(value, index + candidate.value.length)
	);
	if (resolved) {
		return {
			end: index + resolved.value.length,
			item: resolved.item,
			token: resolved.value,
		};
	}

	let end = tokenStart;
	while (end < value.length && !MENTION_END.test(value[end] ?? "")) {
		end += 1;
	}
	return end === tokenStart ? null : { end, token: value.slice(index, end) };
}

export function formatMentionContent(
	content: string,
	mentionItems: MentionItem[] | undefined
): string {
	let result = "";
	let cursor = 0;
	for (let index = 0; index < content.length; index += 1) {
		const match = findMentionAt(content, index, mentionItems);
		if (!match) {
			continue;
		}
		result += content.slice(cursor, index);
		const displayToken = match.item ? match.item.label : match.token;
		const kind = match.item?.kind ?? "mention";
		const label = match.item?.label ?? match.token.slice(1);
		result += `[**${displayToken}**](#ryu-mention-${kind}-${encodeURIComponent(label)})`;
		cursor = match.end;
		index = match.end - 1;
	}
	return result + content.slice(cursor);
}
