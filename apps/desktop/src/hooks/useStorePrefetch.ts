// apps/desktop/src/hooks/useStorePrefetch.ts
//
// Warms EVERY Store tab's first view when the Store opens, instead of each tab
// fetching on first sight.
//
// The sections are already cached (one QueryClient, `staleTime` 5m / `gcTime`
// 30m), so returning to a tab you have opened is instant. What was not free is
// the FIRST visit to each tab: switching tabs meant a spinner per tab, once per
// session, which reads as "the store reloads every time" — six spinners on the
// way to finding one thing.
//
// So the Store mounts this once and prefetches the default view of each realm in
// the background. It is a cache warm-up, not a second data path: every query is
// built from the SAME descriptor its hook uses (`skillListQuery`,
// `pluginCatalogQuery`, …), so a prefetch cannot land under a key no hook reads —
// the one failure mode of prefetching that looks like it worked and warms
// nothing. Anything a section fetches on demand (details, next pages, community)
// is deliberately left alone.
//
// Two realms key their list on the node's ACTIVE catalog source, which is itself
// a fetch; those chain (`ensureQueryData` for the source, then the list) rather
// than guessing an id, because a list prefetched under the wrong source id is
// exactly the silent no-op this file exists to avoid.

import { ALL_PLUGIN_SOURCES_ID } from "@ryu/marketplace/catalog/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { MODEL_CATEGORY_TASK } from "@/src/lib/api/models.ts";
import { useActiveNode } from "./useActiveNode.ts";
import { agentCatalogQuery } from "./useAgentsCatalog.ts";
import {
	installedAppsQuery,
	pluginCatalogQuery,
	pluginSourcesQuery,
} from "./useAppsCatalog.ts";
import { integrationsListQuery } from "./useIntegrationsCatalog.ts";
import {
	mcpListQuery,
	mcpServersQuery,
	mcpSourcesQuery,
} from "./useMcpCatalog.ts";
import { MODEL_LIST_DEFAULTS, modelListQuery } from "./useModelCatalog.ts";
import { skillPacksQuery } from "./useSkillPacks.ts";
import {
	installedSkillsQuery,
	skillListQuery,
	skillSourcesQuery,
} from "./useSkillsCatalog.ts";

/**
 * Prefetch every Store tab's opening view, once per node, in the background.
 *
 * Mount it from the Store page. Failures are swallowed: a warm-up that could not
 * reach Core must never surface an error the user did not ask for — the tab they
 * actually open will report it in its own empty state.
 */
export function useStorePrefetch(): void {
	const activeNode = useActiveNode();
	const qc = useQueryClient();
	const url = activeNode.url;
	const token = activeNode.token ?? null;

	useEffect(() => {
		if (!url) {
			return;
		}
		const target: ApiTarget = { url, token };
		const ignore = () => undefined;

		// Apps + Plugins — both tabs read ONE catalog query (the variant filter is
		// client-side), so this warms two tabs.
		qc.prefetchQuery(pluginSourcesQuery(target)).catch(ignore);
		qc.prefetchQuery(installedAppsQuery(target)).catch(ignore);
		qc.prefetchInfiniteQuery(
			pluginCatalogQuery(target, {
				query: "",
				// The hook's default view is every marketplace at once, not the node's
				// server-side active source — match it or this warms an unread key.
				source: ALL_PLUGIN_SOURCES_ID,
			})
		).catch(ignore);

		// Skills — the list key carries the active source, which is its own read.
		qc.ensureQueryData(skillSourcesQuery(target))
			.then((sources) =>
				qc.prefetchQuery(
					skillListQuery(target, {
						query: "",
						installedOnly: false,
						source: sources?.active ?? "",
					})
				)
			)
			.catch(ignore);
		qc.prefetchQuery(installedSkillsQuery(target)).catch(ignore);
		// Skill packs — the Packs shelf above the skills list.
		qc.prefetchQuery(skillPacksQuery(target)).catch(ignore);

		// MCP — same source-keyed shape, plus the registered-servers read the
		// section derives installed-state from.
		qc.ensureQueryData(mcpSourcesQuery(target))
			.then((sources) =>
				qc.prefetchInfiniteQuery(
					mcpListQuery(target, { query: "", source: sources?.active ?? "" })
				)
			)
			.catch(ignore);
		qc.prefetchQuery(mcpServersQuery(target)).catch(ignore);

		qc.prefetchQuery(agentCatalogQuery(target)).catch(ignore);
		qc.prefetchInfiniteQuery(
			integrationsListQuery(target, { query: "" })
		).catch(ignore);
		qc.prefetchInfiniteQuery(
			modelListQuery(target, {
				query: MODEL_LIST_DEFAULTS.query,
				sort: MODEL_LIST_DEFAULTS.sort,
				format: MODEL_LIST_DEFAULTS.format,
				installedOnly: MODEL_LIST_DEFAULTS.installedOnly,
				task: MODEL_CATEGORY_TASK[MODEL_LIST_DEFAULTS.category],
				org: MODEL_LIST_DEFAULTS.org,
			})
		).catch(ignore);
	}, [qc, url, token]);
}
