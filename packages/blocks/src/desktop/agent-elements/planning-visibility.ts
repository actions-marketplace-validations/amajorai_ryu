// When the transcript shows the shimmering "Thinking" row under the last turn.
//
// Pure (no @ryu/ui imports) so `bun test` can cover it: this predicate is the
// one that decides whether a chat *looks* busy, and getting it wrong strands a
// conversation in a loading state the user cannot leave — the composer derives
// its Stop button from the same `isStreaming` flag, so a spinner shown without
// it has no matching way to stop.

export interface PlanningVisibilityInput {
	/** False for an empty transcript — nothing to plan under. */
	hasMessages: boolean;
	/** Chat status is `streaming` or `submitted` — a turn is actually in flight. */
	isStreaming: boolean;
	/** The last assistant message has rendered content (text/tool output). */
	lastAssistantHasContent: boolean;
	/** The last message in the transcript is a user turn. */
	lastMessageIsUser: boolean;
	/** The last turn already carries at least one assistant message. */
	lastTurnHasAssistant: boolean;
}

export function shouldShowPlanning({
	hasMessages,
	lastMessageIsUser,
	lastTurnHasAssistant,
	isStreaming,
	lastAssistantHasContent,
}: PlanningVisibilityInput): boolean {
	if (!hasMessages) {
		return false;
	}
	// A trailing user message with no reply means the turn is in flight — but ONLY
	// while this chat is actually streaming. A conversation whose run died (Core
	// restarted, agent crashed, the reply never persisted) reloads with exactly
	// this shape at `status === "ready"`; returning `true` unconditionally left it
	// shimmering "Thinking" forever with no Stop button to press, because the
	// composer's trailing slot stays on voice mode when `isStreaming` is false.
	// Accepted tradeoff: a genuinely-live background run reopened in another tab
	// resumes over SSE with the chat status still `ready`, so it shows no planning
	// row until its first delta lands. Do NOT "fix" that by OR-ing in the
	// conversation's `run_status === "running"` — Core writes that field only from
	// the turn lifecycle and reconciles nothing at boot, so a run killed mid-flight
	// stays `running` forever and the permanent spinner comes straight back.
	if (lastMessageIsUser && !lastTurnHasAssistant) {
		return isStreaming;
	}
	// Assistant turn opened but nothing rendered yet — keep the row until the
	// first content lands, then let the message itself take over.
	return isStreaming && !lastAssistantHasContent;
}
