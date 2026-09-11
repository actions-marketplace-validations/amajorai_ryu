// Desktop user availability.
//
// This is a local interaction policy, not an account-presence claim. The
// Desktop shell owns the setting because AFK detection depends on this window's
// focus and input events; shared chat primitives receive only the resolved
// status through AgentAvailabilityProvider.

import {
	type AgentAvailabilityStatus,
	isAgentAvailabilityStatus,
} from "@ryu/blocks/desktop/agent-availability";
import { registerSetting } from "./settings-registry.ts";

export const USER_AVAILABILITY_STORAGE_KEY = "ryu:user-availability";

export const AFK_TIMEOUT_OPTIONS = [5, 10, 15, 30, 60] as const;
export type AfkTimeoutMinutes = (typeof AFK_TIMEOUT_OPTIONS)[number];

export interface UserAvailabilitySettings {
	afkDetectionEnabled: boolean;
	afkTimeoutMinutes: AfkTimeoutMinutes;
	manualStatus: AgentAvailabilityStatus;
}

export type AvailabilitySource = "afk" | "manual";

export interface UserAvailabilitySnapshot {
	settings: UserAvailabilitySettings;
	source: AvailabilitySource;
	status: AgentAvailabilityStatus;
}

export const DEFAULT_USER_AVAILABILITY_SETTINGS: UserAvailabilitySettings = {
	afkDetectionEnabled: true,
	afkTimeoutMinutes: 10,
	manualStatus: "online",
};

const STATUS_CHANGE_EVENTS = [
	"pointerdown",
	"pointermove",
	"keydown",
	"wheel",
	"touchstart",
] as const;

const MINUTE_MS = 60_000;
const STATUS_TIMER_MIN_MS = 1000;

const listeners = new Set<() => void>();
let settingsCache = readSettings();
let lastActivityAt = Date.now();
let windowFocused = true;
let tracking = false;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotCache: UserAvailabilitySnapshot | null = null;
let lastScheduledActivityAt = 0;

const SERVER_SNAPSHOT: UserAvailabilitySnapshot = {
	settings: DEFAULT_USER_AVAILABILITY_SETTINGS,
	source: "manual",
	status: "online",
};

function isAfkTimeoutMinutes(value: unknown): value is AfkTimeoutMinutes {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		(AFK_TIMEOUT_OPTIONS as readonly number[]).includes(value)
	);
}

function readSettings(): UserAvailabilitySettings {
	try {
		const raw = localStorage.getItem(USER_AVAILABILITY_STORAGE_KEY);
		if (!raw) {
			return DEFAULT_USER_AVAILABILITY_SETTINGS;
		}
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object") {
			return DEFAULT_USER_AVAILABILITY_SETTINGS;
		}
		const record = value as Record<string, unknown>;
		return {
			afkDetectionEnabled:
				typeof record.afkDetectionEnabled === "boolean"
					? record.afkDetectionEnabled
					: DEFAULT_USER_AVAILABILITY_SETTINGS.afkDetectionEnabled,
			afkTimeoutMinutes: isAfkTimeoutMinutes(record.afkTimeoutMinutes)
				? record.afkTimeoutMinutes
				: DEFAULT_USER_AVAILABILITY_SETTINGS.afkTimeoutMinutes,
			manualStatus: isAgentAvailabilityStatus(record.manualStatus)
				? record.manualStatus
				: DEFAULT_USER_AVAILABILITY_SETTINGS.manualStatus,
		};
	} catch {
		return DEFAULT_USER_AVAILABILITY_SETTINGS;
	}
}

function writeSettings(settings: UserAvailabilitySettings): void {
	try {
		localStorage.setItem(
			USER_AVAILABILITY_STORAGE_KEY,
			JSON.stringify(settings)
		);
	} catch {
		// Local preferences are best-effort; the in-memory setting still applies.
	}
}

export function resolveUserAvailability(
	settings: UserAvailabilitySettings,
	now: number,
	lastActivity: number,
	focused: boolean
): { source: AvailabilitySource; status: AgentAvailabilityStatus } {
	if (settings.manualStatus !== "online") {
		return { source: "manual", status: settings.manualStatus };
	}
	if (
		settings.afkDetectionEnabled &&
		(!focused || now - lastActivity >= settings.afkTimeoutMinutes * MINUTE_MS)
	) {
		return { source: "afk", status: "away" };
	}
	return { source: "manual", status: "online" };
}

function snapshotEqual(
	left: UserAvailabilitySnapshot | null,
	right: UserAvailabilitySnapshot
): boolean {
	return (
		left?.source === right.source &&
		left?.status === right.status &&
		left?.settings.afkDetectionEnabled === right.settings.afkDetectionEnabled &&
		left?.settings.afkTimeoutMinutes === right.settings.afkTimeoutMinutes &&
		left?.settings.manualStatus === right.settings.manualStatus
	);
}

function notify(): void {
	snapshotCache = null;
	for (const listener of listeners) {
		listener();
	}
}

function clearStatusTimer(): void {
	if (statusTimer !== null) {
		clearTimeout(statusTimer);
		statusTimer = null;
	}
}

function scheduleStatusTimer(): void {
	clearStatusTimer();
	if (
		!tracking ||
		settingsCache.manualStatus !== "online" ||
		!settingsCache.afkDetectionEnabled ||
		!windowFocused
	) {
		return;
	}
	if (
		resolveUserAvailability(
			settingsCache,
			Date.now(),
			lastActivityAt,
			windowFocused
		).status !== "online"
	) {
		return;
	}
	lastScheduledActivityAt = lastActivityAt;
	const deadline = lastActivityAt + settingsCache.afkTimeoutMinutes * MINUTE_MS;
	const delay = Math.max(STATUS_TIMER_MIN_MS, deadline - Date.now() + 1);
	statusTimer = setTimeout(() => {
		statusTimer = null;
		notify();
		scheduleStatusTimer();
	}, delay);
}

function updateWindowFocus(focused: boolean): void {
	const previous = getUserAvailabilitySnapshot();
	windowFocused = focused;
	const next = getUserAvailabilitySnapshot();
	if (!snapshotEqual(previous, next)) {
		notify();
	}
	scheduleStatusTimer();
}

function markActivity(): void {
	const previous = getUserAvailabilitySnapshot();
	const now = Date.now();
	lastActivityAt = now;
	windowFocused = true;
	const next = getUserAvailabilitySnapshot();
	const statusChanged = !snapshotEqual(previous, next);
	if (statusChanged) {
		notify();
	}
	if (statusChanged || now - lastScheduledActivityAt >= STATUS_TIMER_MIN_MS) {
		scheduleStatusTimer();
	}
}

function handleWindowBlur(): void {
	updateWindowFocus(false);
}

function handleVisibilityChange(): void {
	if (document.visibilityState === "visible" && document.hasFocus()) {
		markActivity();
		return;
	}
	updateWindowFocus(false);
}

function startTracking(): void {
	if (tracking || typeof window === "undefined") {
		return;
	}
	tracking = true;
	windowFocused = document.hasFocus();
	for (const eventName of STATUS_CHANGE_EVENTS) {
		window.addEventListener(eventName, markActivity, { passive: true });
	}
	window.addEventListener("focus", markActivity);
	window.addEventListener("blur", handleWindowBlur);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	scheduleStatusTimer();
}

function stopTracking(): void {
	// The app has a long-lived subscriber, but keep the subscription lifecycle
	// honest for isolated component tests and short-lived companion surfaces.
	clearStatusTimer();
	if (typeof window !== "undefined") {
		for (const eventName of STATUS_CHANGE_EVENTS) {
			window.removeEventListener(eventName, markActivity);
		}
		window.removeEventListener("focus", markActivity);
		window.removeEventListener("blur", handleWindowBlur);
		document.removeEventListener("visibilitychange", handleVisibilityChange);
	}
	tracking = false;
}

function setSettings(next: UserAvailabilitySettings): void {
	const previous = getUserAvailabilitySnapshot();
	settingsCache = next;
	writeSettings(next);
	const current = getUserAvailabilitySnapshot();
	if (!snapshotEqual(previous, current)) {
		notify();
	}
	scheduleStatusTimer();
}

/** Current resolved status, usable by non-React prompt/notification code. */
export function getUserAvailabilitySnapshot(): UserAvailabilitySnapshot {
	const resolution = resolveUserAvailability(
		settingsCache,
		Date.now(),
		lastActivityAt,
		windowFocused
	);
	const next: UserAvailabilitySnapshot = {
		settings: settingsCache,
		source: resolution.source,
		status: resolution.status,
	};
	if (!snapshotEqual(snapshotCache, next)) {
		snapshotCache = next;
	}
	return snapshotCache ?? next;
}

/** Stable Online server snapshot for hydration-safe shared chat rendering. */
export function getUserAvailabilityServerSnapshot(): UserAvailabilitySnapshot {
	return SERVER_SNAPSHOT;
}

/** Subscribe to status changes, including local activity and other windows. */
export function subscribeUserAvailability(callback: () => void): () => void {
	listeners.add(callback);
	if (listeners.size === 1) {
		startTracking();
	}
	const onStorage = (event: StorageEvent) => {
		if (event.key !== USER_AVAILABILITY_STORAGE_KEY) {
			return;
		}
		const previous = getUserAvailabilitySnapshot();
		settingsCache = readSettings();
		const next = getUserAvailabilitySnapshot();
		if (!snapshotEqual(previous, next)) {
			notify();
		}
		scheduleStatusTimer();
	};
	if (typeof window !== "undefined") {
		window.addEventListener("storage", onStorage);
	}
	return () => {
		listeners.delete(callback);
		if (typeof window !== "undefined") {
			window.removeEventListener("storage", onStorage);
		}
		if (listeners.size === 0) {
			stopTracking();
		}
	};
}

/** Set the manual status; Online still allows AFK auto-away when enabled. */
export function setUserAvailabilityStatus(
	manualStatus: AgentAvailabilityStatus
): void {
	setSettings({ ...settingsCache, manualStatus });
}

/** Toggle whether idle or unfocused windows become Away automatically. */
export function setAfkDetectionEnabled(enabled: boolean): void {
	setSettings({ ...settingsCache, afkDetectionEnabled: enabled });
}

/** Set the allowlisted AFK timeout in minutes. */
export function setAfkTimeoutMinutes(minutes: AfkTimeoutMinutes): void {
	if (!isAfkTimeoutMinutes(minutes)) {
		return;
	}
	setSettings({ ...settingsCache, afkTimeoutMinutes: minutes });
}

/** Restore the availability policy to its shipped defaults. */
export function resetUserAvailability(): void {
	lastActivityAt = Date.now();
	windowFocused = true;
	setSettings(DEFAULT_USER_AVAILABILITY_SETTINGS);
}

registerSetting({
	category: "general",
	id: "general.availability",
	label: "Availability & prompts",
	reset: resetUserAvailability,
});
