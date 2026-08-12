// apps/desktop/src/hooks/useTimezone.ts
//
// React binding for the shared display time zone (see @/src/lib/timezone.ts).
//
// The formatters read the store at call time, so a component only needs one of
// these hooks when it must re-render the *moment* the zone changes rather than
// on its next natural render — the sidebar and the Appearance preview do.

import { useCallback, useSyncExternalStore } from "react";
import {
	DEFAULT_TIMEZONE,
	getTimezonePreference,
	setTimezonePreference,
	subscribeTimezone,
} from "@/src/lib/timezone.ts";

/**
 * `[timezone, setTimezone]` where `timezone` is `"system"` or an IANA zone id.
 * Persisted, shared across windows.
 */
export function useTimezone(): [string, (value: string) => void] {
	const timezone = useSyncExternalStore(
		subscribeTimezone,
		getTimezonePreference,
		() => DEFAULT_TIMEZONE
	);

	const setTimezone = useCallback((value: string) => {
		setTimezonePreference(value);
	}, []);

	return [timezone, setTimezone];
}

/**
 * Subscribe to zone changes without caring what the zone is — for components
 * that only render formatted timestamps and just need to repaint.
 */
export function useTimezoneRevision(): string {
	return useSyncExternalStore(
		subscribeTimezone,
		getTimezonePreference,
		() => DEFAULT_TIMEZONE
	);
}
