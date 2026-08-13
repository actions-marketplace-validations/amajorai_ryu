/**
 * Completion rule for a "Thinking" row.
 *
 * Its own module rather than a function inside `thinking-tool.tsx` so it can be
 * unit-tested: that file pulls in `@ryu/ui` components (via `tool-row-base`),
 * which the test runner cannot resolve.
 */

import type { StepState } from "../types/timeline.ts";

/**
 * The state a Thinking row should actually render in.
 *
 * The part's own state says "still thinking" until its closing frame arrives,
 * and that frame is exactly what a crashed, cancelled or Core-restarted turn
 * never sends — so a payload-only reading shimmers and counts up forever,
 * including days later when the thread is reopened. The chat's status is the
 * second opinion, and `getToolStatus` (utils/format-tool.ts) already fixes its
 * meaning for every other tool row: pending ONLY while the chat is streaming,
 * so `undefined` (a message that is not the live last one) already reads as
 * "not pending" there. This mirrors that rule rather than inventing a third.
 *
 * A caller that supplies `state` itself (`stateFromPart` false) keeps full
 * control: it is not reading the part, so there is nothing to second-guess.
 */
export function resolveThinkingStepState({
	chatStatus,
	stateFromPart,
	stepState,
}: {
	chatStatus?: string;
	stateFromPart: boolean;
	stepState: StepState;
}): StepState {
	const chatIsRunning =
		chatStatus === "streaming" || chatStatus === "submitted";
	if (stateFromPart && stepState === "animating" && !chatIsRunning) {
		return "complete";
	}
	return stepState;
}
