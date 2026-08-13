// apps/desktop/src/hooks/useTimezone.ts
//
// React binding for the shared display time zone (see @/src/lib/timezone.ts).
//
// The formatters read the store at call time, so a component only needs one of
// these hooks when it must re-render the *moment* the zone changes rather than
// on its next natural render — the sidebar and the Appearance preview do.
//
// `useTimezoneRevision` itself lives beside the store in
// `@ryu/ui/lib/timezone.ts` so `@ryu/blocks` (the chat transcript) can reach it
// without importing `apps/desktop`. It is re-exported here so every desktop
// importer of this path keeps working, and so both hooks stay one import away
// from each other.

import { useCallback, useSyncExternalStore } from "react";
import {
	DEFAULT_TIMEZONE,
	getTimezonePreference,
	setTimezonePreference,
	subscribeTimezone,
} from "@/src/lib/timezone.ts";

export { useTimezoneRevision } from "@/src/lib/timezone.ts";

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
