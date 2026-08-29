// apps/desktop/src/lib/gating/useEnabledApps.ts
//
// The set of app ids currently installed AND enabled on the active node. This
// is also used by lifecycle-aware surfaces such as the Meetings event stream;
// it is not a billing or plan entitlement check.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { fetchApps } from "@/src/lib/api/plugins.ts";

/** Stable empty set so an in-flight or failed fetch yields one reference. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Ids of the enabled apps on the active node, or `undefined` while that is still
 * unknown (first fetch in flight, or Core unreachable).
 */
export function useEnabledApps(): ReadonlySet<string> | undefined {
	const node = useActiveNode();
	const { data } = useQuery({
		queryKey: ["gating-enabled-apps", node.url, node.token],
		queryFn: () =>
			fetchApps({
				url: node.url,
				token: node.token,
				userJwt: node.userJwt ?? null,
			}),
		staleTime: 60_000,
		retry: false,
	});
	return useMemo(() => {
		if (!data) {
			return undefined;
		}
		const enabled = data.filter((app) => app.enabled).map((app) => app.id);
		return enabled.length > 0 ? new Set(enabled) : NONE;
	}, [data]);
}
