import { useSyncExternalStore } from "react";

/** Where the desktop puts the Inbox and announcement feed. */
export const NOTIFICATION_LAYOUT_STEPS = [
	{
		description: "Keep the announcement stack and Inbox tray separate.",
		id: "split",
		label: "Split",
	},
	{
		description:
			"Share one tray while keeping Inbox and announcements grouped.",
		id: "grouped",
		label: "Grouped",
	},
	{
		description: "Blend everything into one compact notification stack.",
		id: "unified",
		label: "Unified",
	},
] as const;

export type NotificationLayout =
	(typeof NOTIFICATION_LAYOUT_STEPS)[number]["id"];

export const NOTIFICATION_LAYOUT_KEY = "ryu:notification-layout";
export const DEFAULT_NOTIFICATION_LAYOUT: NotificationLayout = "unified";

const listeners = new Set<() => void>();

function isNotificationLayout(
	value: string | null
): value is NotificationLayout {
	return NOTIFICATION_LAYOUT_STEPS.some((step) => step.id === value);
}

function readNotificationLayout(): NotificationLayout {
	try {
		const stored = localStorage.getItem(NOTIFICATION_LAYOUT_KEY);
		return isNotificationLayout(stored) ? stored : DEFAULT_NOTIFICATION_LAYOUT;
	} catch {
		return DEFAULT_NOTIFICATION_LAYOUT;
	}
}

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	const onStorage = (event: StorageEvent) => {
		if (event.key === NOTIFICATION_LAYOUT_KEY) {
			callback();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(callback);
		window.removeEventListener("storage", onStorage);
	};
}

/** Persist the layout and update every desktop surface in this window. */
export function setNotificationLayout(value: NotificationLayout): void {
	try {
		localStorage.setItem(NOTIFICATION_LAYOUT_KEY, value);
	} catch {
		// Appearance preferences are best-effort when storage is unavailable.
	}
	for (const listener of listeners) {
		listener();
	}
}

/** Read the shared layout preference reactively. */
export function useNotificationLayout(): NotificationLayout {
	return useSyncExternalStore(
		subscribe,
		readNotificationLayout,
		() => DEFAULT_NOTIFICATION_LAYOUT
	);
}

export function notificationLayoutStepIndex(
	layout: NotificationLayout
): number {
	return Math.max(
		0,
		NOTIFICATION_LAYOUT_STEPS.findIndex((step) => step.id === layout)
	);
}
