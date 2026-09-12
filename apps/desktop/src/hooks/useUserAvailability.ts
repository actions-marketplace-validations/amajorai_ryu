import { useCallback, useSyncExternalStore } from "react";
import {
	getUserAvailabilityServerSnapshot,
	getUserAvailabilitySnapshot,
	setAfkDetectionEnabled,
	setAfkTimeoutMinutes,
	setUserAvailabilityStatus,
	subscribeUserAvailability,
} from "@/src/lib/user-availability.ts";

/** React binding for the Desktop's local availability and AFK policy. */
export function useUserAvailability() {
	const snapshot = useSyncExternalStore(
		subscribeUserAvailability,
		getUserAvailabilitySnapshot,
		getUserAvailabilityServerSnapshot
	);

	const setStatus = useCallback(setUserAvailabilityStatus, []);
	const setAfkDetection = useCallback(setAfkDetectionEnabled, []);
	const setAfkTimeout = useCallback(setAfkTimeoutMinutes, []);

	return {
		...snapshot,
		setAfkDetection,
		setAfkTimeout,
		setStatus,
	};
}
