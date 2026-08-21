import { useCallback, useSyncExternalStore } from "react";

export type ChatPickerPlacement = "composer" | "tab-bar";

export const CHAT_PICKER_PLACEMENT_KEY = "ryu:chat-picker-placement";
export const DEFAULT_CHAT_PICKER_PLACEMENT: ChatPickerPlacement = "composer";

const listeners = new Set<() => void>();

function readFromStorage(): ChatPickerPlacement {
	try {
		return localStorage.getItem(CHAT_PICKER_PLACEMENT_KEY) === "tab-bar"
			? "tab-bar"
			: DEFAULT_CHAT_PICKER_PLACEMENT;
	} catch {
		return DEFAULT_CHAT_PICKER_PLACEMENT;
	}
}

let cache = readFromStorage();

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	const onStorage = (event: StorageEvent) => {
		if (event.key === CHAT_PICKER_PLACEMENT_KEY) {
			cache = readFromStorage();
			callback();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(callback);
		window.removeEventListener("storage", onStorage);
	};
}

function getSnapshot(): ChatPickerPlacement {
	return cache;
}

function getServerSnapshot(): ChatPickerPlacement {
	return DEFAULT_CHAT_PICKER_PLACEMENT;
}

export function setChatPickerPlacement(value: ChatPickerPlacement): void {
	cache = value;
	try {
		localStorage.setItem(CHAT_PICKER_PLACEMENT_KEY, value);
	} catch {
		// Persistence is best effort; the in-memory value still applies now.
	}
	for (const callback of listeners) {
		callback();
	}
}

export function useChatPickerPlacement(): [
	ChatPickerPlacement,
	(value: ChatPickerPlacement) => void,
] {
	const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const setValue = useCallback(
		(next: ChatPickerPlacement) => setChatPickerPlacement(next),
		[]
	);
	return [value, setValue];
}
