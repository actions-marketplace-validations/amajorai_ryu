import { useCallback, useSyncExternalStore } from "react";

/** When composer target changes should be described as taking effect. */
export type ComposerSelectionApplyMode = "next-turn" | "next-user-message";

export const COMPOSER_SELECTION_APPLY_MODE_KEY =
	"ryu:composer-selection-apply-mode";
export const DEFAULT_COMPOSER_SELECTION_APPLY_MODE: ComposerSelectionApplyMode =
	"next-turn";

/** The notice is useful only when a selection cannot affect the live response. */
export function shouldShowComposerSelectionToast(
	turnInFlight: boolean
): boolean {
	return turnInFlight;
}

/** Copy used by the busy-only composer selection notice. */
export function composerSelectionToastDescription(
	mode: ComposerSelectionApplyMode
): string {
	return mode === "next-user-message"
		? "Applies from your next message."
		: "Applies on the next turn.";
}

const listeners = new Set<() => void>();

function readMode(): ComposerSelectionApplyMode {
	try {
		const value = localStorage.getItem(COMPOSER_SELECTION_APPLY_MODE_KEY);
		return value === "next-user-message" || value === "next-turn"
			? value
			: DEFAULT_COMPOSER_SELECTION_APPLY_MODE;
	} catch {
		return DEFAULT_COMPOSER_SELECTION_APPLY_MODE;
	}
}

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	const onStorage = (event: StorageEvent) => {
		if (event.key === COMPOSER_SELECTION_APPLY_MODE_KEY) {
			callback();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(callback);
		window.removeEventListener("storage", onStorage);
	};
}

/** Read the setting synchronously for non-React send/notification paths. */
export function readComposerSelectionApplyMode(): ComposerSelectionApplyMode {
	return readMode();
}

export function setComposerSelectionApplyMode(
	mode: ComposerSelectionApplyMode
): void {
	try {
		localStorage.setItem(COMPOSER_SELECTION_APPLY_MODE_KEY, mode);
	} catch {
		// A preference that cannot be persisted still applies for this window.
	}
	for (const listener of listeners) {
		listener();
	}
}

/** `[mode, setMode]` for the General → Chats preference. */
export function useComposerSelectionApplyMode(): [
	ComposerSelectionApplyMode,
	(mode: ComposerSelectionApplyMode) => void,
] {
	const mode = useSyncExternalStore(
		subscribe,
		readMode,
		() => DEFAULT_COMPOSER_SELECTION_APPLY_MODE
	);
	const setMode = useCallback(
		(next: ComposerSelectionApplyMode) => setComposerSelectionApplyMode(next),
		[]
	);
	return [mode, setMode];
}
