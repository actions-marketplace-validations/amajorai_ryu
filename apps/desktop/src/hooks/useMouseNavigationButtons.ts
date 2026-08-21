import { useEffect } from "react";

export const MOUSE_BACK_BUTTON = 3;
export const MOUSE_FORWARD_BUTTON = 4;

type MouseNavigationAction = "back" | "forward";

export interface MouseNavigationEvent {
	button: number;
	preventDefault: () => void;
}

interface MouseNavigationCallbacks {
	goBack: () => void;
	goForward: () => void;
}

/** Resolve the standard X-button mapping used by mice with navigation buttons. */
export function getMouseNavigationAction(
	button: number
): MouseNavigationAction | null {
	if (button === MOUSE_BACK_BUTTON) {
		return "back";
	}
	if (button === MOUSE_FORWARD_BUTTON) {
		return "forward";
	}
	return null;
}

/**
 * Build the event handler shared by the pointer, mouse, and auxiliary-mouse
 * event paths. WebViews differ in which of those events they expose for X
 * buttons, and some expose more than one for a single physical click.
 */
export function createMouseNavigationHandler({
	goBack,
	goForward,
}: MouseNavigationCallbacks) {
	const handledButtons = new Set<number>();
	const resetTimers = new Map<number, ReturnType<typeof setTimeout>>();

	const handle = (event: MouseNavigationEvent) => {
		const action = getMouseNavigationAction(event.button);
		if (!action) {
			return;
		}

		// Stop the WebView's own history navigation. The app's tab history is the
		// source of truth for the buttons in the desktop navigation cluster.
		event.preventDefault();

		// A single X-button press can surface as pointerdown + mousedown + pointerup
		// + mouseup + auxclick.
		// Navigate once, then allow a later physical click through on the next task.
		if (handledButtons.has(event.button)) {
			return;
		}
		handledButtons.add(event.button);
		const resetTimer = setTimeout(() => {
			handledButtons.delete(event.button);
			resetTimers.delete(event.button);
		}, 0);
		resetTimers.set(event.button, resetTimer);

		if (action === "back") {
			goBack();
			return;
		}
		goForward();
	};

	const dispose = () => {
		for (const timer of resetTimers.values()) {
			clearTimeout(timer);
		}
		resetTimers.clear();
		handledButtons.clear();
	};

	return { dispose, handle };
}

/** Listen globally so side buttons work over every desktop surface. */
export function useMouseNavigationButtons(
	goBack: () => void,
	goForward: () => void
) {
	useEffect(() => {
		const navigationHandler = createMouseNavigationHandler({
			goBack,
			goForward,
		});
		const eventTypes = [
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"auxclick",
		] as const;

		for (const eventType of eventTypes) {
			window.addEventListener(eventType, navigationHandler.handle, true);
		}
		return () => {
			for (const eventType of eventTypes) {
				window.removeEventListener(eventType, navigationHandler.handle, true);
			}
			navigationHandler.dispose();
		};
	}, [goBack, goForward]);
}
