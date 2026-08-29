// apps/desktop/src/components/store/dependency-lookup.ts
//
// Desktop binding for the Dependencies tab's graph resolver: answers "what does
// this node already have?" for one plugin id.
//
// `/api/plugins` carries every manifest Core has loaded — installed or not, with
// `installed`/`enabled` attached per row — and each one's own `requires`, so a
// single already-cached list answers the whole tree: display names, live state,
// and the next level down. The query key is the SAME one `useAppsCatalog` uses, so
// mounting this above the store adds no round-trip and the tab can never disagree
// with the cards about what is enabled.
//
// One known blind spot: Core applies the `x-ryu-surface` filter to this list, so a
// dependency that targets only `core`/`gateway` is absent from a desktop read and
// resolves to `null` — the panel then reports it as arriving with the install even
// if the node already has it. Understating what is present is the safe direction,
// and closing it properly needs a surface-agnostic read, not a guess here.

import type {
	DependencyLookup,
	DependencyRecord,
} from "@ryu/marketplace/catalog/detail/dependency-graph";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { fetchApps } from "@/src/lib/api/plugins.ts";

export function useDesktopDependencyLookup(): DependencyLookup {
	const node = useActiveNode();
	const url = node.url;
	const token = node.token ?? null;
	const userJwt = node.userJwt ?? null;
	const { data } = useQuery({
		queryKey: ["apps", "list", url],
		queryFn: () => fetchApps({ url, token, userJwt }),
		// A dependency tree is descriptive, not transactional: a slightly stale
		// enabled bit is corrected by the lifecycle mutations, which invalidate this
		// very key.
		staleTime: 30_000,
	});

	const byId = useMemo(() => {
		const map = new Map<string, DependencyRecord>();
		for (const app of data ?? []) {
			map.set(app.id, {
				enabled: app.enabled,
				installed: app.installed,
				name: app.name,
				requires: app.requires?.apps ?? [],
			});
		}
		return map;
	}, [data]);

	return useCallback((id: string) => byId.get(id) ?? null, [byId]);
}
