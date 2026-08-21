export interface AnswerNowControl {
	onClick: () => void;
	pending?: boolean;
}

/**
 * Delay before a native provider's Answer now affordance becomes useful. The
 * provider owns whether the action exists; this shared policy only gives harder
 * reasoning efforts more time to make progress before adding another control.
 */
export function answerNowDelayMs(effort?: string): number {
	switch (effort?.trim().toLowerCase()) {
		case "low":
			return 1200;
		case "medium":
			return 2200;
		case "high":
			return 3500;
		case "xhigh":
		case "max":
			return 5000;
		default:
			return 2200;
	}
}
