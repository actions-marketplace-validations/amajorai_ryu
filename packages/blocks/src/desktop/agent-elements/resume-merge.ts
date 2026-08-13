/**
 * Folding a resumed stream's text back into an assistant message's parts.
 *
 * Extracted from the chat page purely so it can be tested: the resume reader is
 * a hand-rolled SSE loop that only understands `text-delta`, and the bug this
 * guards against — writing `parts: [{type:"text", …}]` wholesale, which deleted
 * every tool row, Thinking trace and stats part of a turn it had merely
 * RECONNECTED to — is invisible until you reload a chat that was resumed.
 */

type MaybePart = { type?: string } | null | undefined;

const isTextPart = (part: unknown): boolean =>
	(part as MaybePart)?.type === "text";

/**
 * Merge `text` into `parts` as the message's single text part, preserving every
 * non-text part and the position the first text part occupied.
 *
 * Text parts are COLLAPSED into one rather than appended to: the reader
 * accumulates the whole reply (it seeds from the persisted `content`), so
 * keeping the old ones would render the answer twice.
 *
 * This used to carry a second job — stripping the "⚠️ Interrupted…" sentence the
 * history mapper appended as a trailing text part to a cut-off turn. That note
 * is gone; interruption is metadata (`_interrupted`) drawn as a marker, so there
 * is nothing in `parts` left to strip. The collapse still covers a thread
 * hydrated by an older build, which is why the behaviour is still tested.
 */
/**
 * Fold a resumed delta into a whole assistant MESSAGE — its parts, and the
 * metadata a delta disproves.
 *
 * Prefer this over calling `mergeResumedReplyText` directly. The extra job is
 * clearing `_interrupted`: the history mapper stamps that flag on a turn Core
 * recorded as cut off (`apps/desktop/src/lib/chat-history-hydrate.ts`), and the
 * transcript draws it as an "Interrupted — this reply was cut off" marker under
 * the turn. A text delta is proof the turn is live again, so leaving the flag on
 * parks a crash notice underneath text that is still streaming.
 *
 * It used to clear itself by accident. Interruption was an appended text part
 * back then, and the collapse below swallowed it as a side effect — so when the
 * note became metadata, the unsetting had to become explicit or it would be
 * silently lost. That is the whole reason this wrapper exists rather than being
 * inlined at the one call site.
 */
export function mergeResumedReplyMessage<T extends { parts?: unknown[] }>(
	message: T,
	text: string
): T {
	return {
		...message,
		_interrupted: false,
		parts: mergeResumedReplyText(message.parts, text),
	} as unknown as T;
}

export function mergeResumedReplyText(
	parts: unknown[] | undefined,
	text: string
): unknown[] {
	const list = parts ?? [];
	const others = list.filter((part) => !isTextPart(part));
	const textPart = { type: "text" as const, text };
	const firstTextAt = list.findIndex(isTextPart);
	if (firstTextAt === -1) {
		return [...others, textPart];
	}
	// How many non-text parts precede the first text part — that index in
	// `others` is where the merged text belongs.
	const before = list
		.slice(0, firstTextAt)
		.filter((part) => !isTextPart(part)).length;
	return [...others.slice(0, before), textPart, ...others.slice(before)];
}
