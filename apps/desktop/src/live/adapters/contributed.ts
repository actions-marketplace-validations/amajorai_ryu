// apps/desktop/src/live/adapters/contributed.ts
//
// Live-activity adapter for CONTRIBUTED activities (`contributes.live_activities`).
// For each enabled plugin's declared live activity, polls its `source` (a Core
// `/api/` path) through the host's authenticated seam and maps the response rows
// to live-activity cards via the shared `@ryu/app-host/live-activity` mappers.
// This is how an app exposes a live activity with ZERO sidecar code — the same
// relationship `DynamicSidebarSection` has to `sidebar_sections`.

import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
	type LiveActivity,
	actionForLiveActivity,
	liveActivitiesFromResponse,
} from "@ryu/app-host/live-activity";
import { isCoreApiPath } from "@ryu/app-host/views";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import type { PluginLiveActivity } from "@/src/lib/api/plugins.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import { useLiveActivityStore } from "@/src/store/useLiveActivityStore.ts";

const REFRESH_FLOOR_MS = 1000;

/** Map one contributed activity's source payload to cards (shared mapper). */
function mapContribution(
	contribution: PluginLiveActivity,
	payload: unknown,
	now: number
): LiveActivity[] {
	return liveActivitiesFromResponse(
		contribution,
		payload,
		now
	).map(({ activity, raw }) => ({
		...activity,
		action: actionForLiveActivity(contribution, raw),
	}));
}

/** Reconcile one contribution's cards into the registry (removes rows that left
 *  the source, so a settled run vanishes from the dock). */
function reconcileContribution(prefix: string, activities: LiveActivity[]) {
	const store = useLiveActivityStore.getState();
	const desiredIds = new Set(activities.map((a) => a.id));
	const existing = Object.keys(store.activities);
	for (const id of existing) {
		if (id.startsWith(prefix) && !desiredIds.has(id)) {
			store.remove(id);
		}
	}
	for (const activity of activities) {
		store.upsert(activity);
	}
}

/**
 * Poll every contributed live activity's `source` and reconcile its cards into
 * the live-activity store. One fetch per (node, path, method) via a shared query
 * key so sibling contributions reading the same endpoint share the payload —
 * the same caching `DynamicSidebarSection` uses. A dead node or a route gated
 * behind a disabled app answers non-2xx: that is an empty dock, not an error to
 * retry into.
 */
export function useContributedLiveActivities(): void {
	const node = useActiveNode();
	const { live_activities } = usePluginContributions();
	const target = toTarget(node);

	const fetchable = useMemo(
		() =>
			live_activities.filter(
				(a) =>
					a.spec?.source?.http?.path &&
					isCoreApiPath(a.spec.source.http.path)
			),
		[live_activities]
	);

	const queries = useQueries({
		queries: fetchable.map((contribution) => {
			const source = contribution.spec?.source;
			const sourcePath = source?.http.path;
			const sourceMethod = source?.http.method ?? "GET";
			return {
				queryKey: [
					"contributed-live-activity-source",
					target.url,
					target.token,
					sourcePath,
					sourceMethod,
					contribution.plugin ?? "",
					contribution.id,
				],
				retry: false,
				queryFn: async () => {
					const resp = await fetch(apiUrl(target, sourcePath as string), {
						method: sourceMethod,
						headers: makeHeaders(target.token),
					});
					return resp.ok ? ((await resp.json()) as unknown) : null;
				},
				refetchInterval: source?.refreshMs
					? Math.max(source.refreshMs, REFRESH_FLOOR_MS)
					: false,
			};
		}),
	});

	// Reconcile each contribution's payload into the store. Runs on every data
	// change (payload fetched/refreshed) — reconciliation is idempotent.
	useEffect(() => {
		for (let i = 0; i < fetchable.length; i += 1) {
			const contribution = fetchable[i];
			const payload = queries[i]?.data ?? null;
			if (!contribution) {
				continue;
			}
			reconcileContribution(
				`plugin:${contribution.plugin ?? "unknown"}:${contribution.id}:`,
				payload ? mapContribution(contribution, payload, Date.now()) : []
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [queries, fetchable]);
}
