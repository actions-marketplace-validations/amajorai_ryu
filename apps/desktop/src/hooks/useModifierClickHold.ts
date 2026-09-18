import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
} from "react";
import {
	type QuickPreviewModifier,
	quickPreviewModifierMatches,
} from "./useQuickPreviewModifier.ts";

export const QUICK_PREVIEW_HOLD_MS = 420;

interface ModifierClickHoldOptions {
	modifier: QuickPreviewModifier;
	onTrigger: () => void;
}

interface ModifierClickHoldHandlers {
	consumeTriggered: () => boolean;
	onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
	onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) {
		return false;
	}
	const interactive = target.closest(
		"button,a,input,textarea,select,[role=menuitem]"
	);
	return Boolean(
		interactive &&
			interactive.getAttribute("data-slot") !== "hover-card-trigger"
	);
}

/**
 * Reserve a modifier-held primary-pointer gesture for a delayed action.
 *
 * The pointer-down default is cancelled as soon as the configured modifier is
 * present. That prevents a long press from becoming a drag or a selection,
 * while a quick unmodified click keeps the row's normal navigation behavior.
 */
export function useModifierClickHold({
	modifier,
	onTrigger,
}: ModifierClickHoldOptions): ModifierClickHoldHandlers {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const triggeredRef = useRef(false);
	const onTriggerRef = useRef(onTrigger);
	onTriggerRef.current = onTrigger;

	const clearTimer = useCallback(() => {
		if (timerRef.current === null) {
			return;
		}
		clearTimeout(timerRef.current);
		timerRef.current = null;
	}, []);

	useEffect(() => clearTimer, [clearTimer]);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			clearTimer();
			triggeredRef.current = false;
			if (
				event.button !== 0 ||
				isInteractiveTarget(event.target) ||
				!quickPreviewModifierMatches(event, modifier)
			) {
				return;
			}

			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				triggeredRef.current = true;
				onTriggerRef.current();
			}, QUICK_PREVIEW_HOLD_MS);
		},
		[clearTimer, modifier]
	);

	const releasePointer = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		[]
	);

	const onPointerUp = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			clearTimer();
			if (triggeredRef.current) {
				event.preventDefault();
				event.stopPropagation();
			}
			releasePointer(event);
		},
		[clearTimer, releasePointer]
	);

	const onPointerCancel = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			clearTimer();
			releasePointer(event);
		},
		[clearTimer, releasePointer]
	);

	const consumeTriggered = useCallback(() => {
		const triggered = triggeredRef.current;
		triggeredRef.current = false;
		return triggered;
	}, []);

	return {
		consumeTriggered,
		onPointerCancel,
		onPointerDown,
		onPointerUp,
	};
}
