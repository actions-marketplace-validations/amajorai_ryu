// apps/desktop/src/lib/gating/useEnabledApps.ts
//
// The set of app ids currently installed AND enabled on the active node. This
// is also used by lifecycle-aware surfaces such as the Meetings event stream;
// it is not a billing or plan entitlement check.

import { useMemo } from "react";
import { useApps } from "@/src/hooks/useApps.ts";

/** Stable empty set when the loaded roster has no enabled apps. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Ids of the enabled apps on the active node, or `undefined` while that is still
 * unknown (first fetch in flight, or Core unreachable).
 */
export function useEnabledApps(): ReadonlySet<string> | undefined {
	const { apps, loading, error } = useApps();
	return useMemo(() => {
		if (loading || error) {
			return undefined;
		}
		const enabled = apps.filter((app) => app.enabled).map((app) => app.id);
		return enabled.length > 0 ? new Set(enabled) : NONE;
	}, [apps, loading, error]);
}
