import { useCallback, useEffect, useRef, useState } from "react";

export const COMPOSER_PROMPT_TYPING_IDLE_MS = 2500;
/** @deprecated Prefer the shared composer-prompt name. */
export const QUESTION_TYPING_IDLE_MS = COMPOSER_PROMPT_TYPING_IDLE_MS;

/**
 * Keep agent-initiated composer prompts (questions and approvals) out of the
 * composer while its user is actively drafting. The raw request stays in the
 * transcript until the idle timer wins, so delaying the card never makes the
 * pending request disappear altogether.
 */
export function useDeferredComposerPrompt<T>(
	prompt: T | null,
	idleMs = COMPOSER_PROMPT_TYPING_IDLE_MS
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
		visiblePrompt: isComposerActive ? null : prompt,
	};
}

/** Backwards-compatible name for consumers that specifically handle questions. */
export function useDeferredQuestion<T>(question: T | null, idleMs?: number) {
	const deferred = useDeferredComposerPrompt(question, idleMs);
	return {
		...deferred,
		visibleQuestion: deferred.visiblePrompt,
	};
}
