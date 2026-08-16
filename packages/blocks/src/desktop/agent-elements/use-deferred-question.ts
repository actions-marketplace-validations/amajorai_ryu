import { useCallback, useEffect, useRef, useState } from "react";

export const QUESTION_TYPING_IDLE_MS = 2500;

/**
 * Keep agent-initiated Q&A out of the composer while its user is actively
 * drafting. The raw question stays in the transcript until the idle timer wins,
 * so delaying the card never makes the pending request disappear altogether.
 */
export function useDeferredQuestion<T>(
	question: T | null,
	idleMs = QUESTION_TYPING_IDLE_MS
) {
	const [isComposerActive, setIsComposerActive] = useState(false);
	const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearIdleTimer = useCallback(() => {
		if (idleTimerRef.current !== null) {
			clearTimeout(idleTimerRef.current);
			idleTimerRef.current = null;
		}
	}, []);

	const markComposerActivity = useCallback(() => {
		clearIdleTimer();
		setIsComposerActive(true);
		idleTimerRef.current = setTimeout(() => {
			idleTimerRef.current = null;
			setIsComposerActive(false);
		}, idleMs);
	}, [clearIdleTimer, idleMs]);

	const markComposerIdle = useCallback(() => {
		clearIdleTimer();
		setIsComposerActive(false);
	}, [clearIdleTimer]);

	useEffect(() => clearIdleTimer, [clearIdleTimer]);

	return {
		markComposerActivity,
		markComposerIdle,
		visibleQuestion: isComposerActive ? null : question,
	};
}
