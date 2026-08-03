// apps/desktop/src/lib/gating/useEnabledApps.ts
//
// The set of app ids currently installed AND enabled on the active node — the
// half of a numeric cap that `plans.ts` cannot know.
//
// A quota key is DECLARED by the app that owns it (`contributes.quotas` in the
// manifest; `APP_QUOTAS` carries the owner id and the per-tier numbers). The
// declaration says the key exists, not that this node is subject to it: a user
// who never installed Monitors must never be told they ran out of monitors. Only
// the client knows what is installed, so the app-enablement half of the decision
// lives here and feeds `planCapBridge`.
//
// Deliberately react-query-cached on a shared key rather than reusing
// `useApps()`: every entity-creation flow mounts `useEntityCap`, and `useApps`
// refetches per mount (plus carries the whole enable/disable lifecycle this has
// no use for). One cached read serves all of them.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { fetchApps } from "@/src/lib/api/plugins.ts";

/** Stable empty set so an in-flight or failed fetch yields one reference. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Ids of the enabled apps on the active node, or `undefined` while that is still
 * unknown (first fetch in flight, or Core unreachable). `undefined` is not the
 * same as "none": the caps fail OPEN on unknown, so the distinction is what keeps
 * a payer from being briefly capped on an app they do have.
 */
export function useEnabledApps(): ReadonlySet<string> | undefined {
	const node = useActiveNode();
	const { data } = useQuery({
		queryKey: ["gating-enabled-apps", node.url, node.token],
		queryFn: () => fetchApps({ url: node.url, token: node.token ?? null }),
		// Caps are symbolic, so a stale window well past a toggle is harmless and
		// keeps every mounted creation flow off Core. `retry` off: an unreachable
		// Core should leave the set unknown (uncapped) at once, not after 3 tries.
		staleTime: 60_000,
		retry: false,
	});
	return useMemo(() => {
		if (!data) {
			return undefined;
		}
		// `enabled` alone is the whole test: Core derives it from the lifecycle
		// record (`enabled: lc.map_or(false, |r| r.enabled)`) and `installed` from
		// that record existing, so enabled implies installed.
		const enabled = data.filter((app) => app.enabled).map((app) => app.id);
		return enabled.length > 0 ? new Set(enabled) : NONE;
	}, [data]);
}
