import type { UIMessage } from "ai";

/** Metadata attached to a client-authored message that sets or edits a goal. */
export interface GoalMessageMetadata {
	goal?: boolean;
}

/** True when a user message represents a goal-setting action. */
export function isGoalMessage(message: UIMessage): boolean {
	const metadata = (message as { metadata?: unknown }).metadata;
	if (typeof metadata !== "object" || metadata === null) {
		return false;
	}
	return (metadata as GoalMessageMetadata).goal === true;
}
