import {
	isCoreApiPath,
	type StoreCatalogItem,
	storeItemsFromResponse,
	storeTotalFromResponse,
} from "@ryu/app-host/views";
import { useQuery } from "@tanstack/react-query";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginStoreTab } from "@/src/lib/api/plugins.ts";

export interface ContributedStoreCatalogData {
	items: StoreCatalogItem[];
	total: number | null;
}

/** Build the single cached source query shared by the tab and its nav count. */
export function contributedStoreCatalogQuery(
	tab: PluginStoreTab,
	target: ReturnType<typeof toTarget>,
	enabled: boolean
) {
	const spec = tab.spec;
	const source = spec?.source;
	const path = source?.http.path;
	return {
		enabled: enabled && Boolean(source),
		queryKey: ["store-tab-catalog", tab.plugin, tab.id, target.url],
		queryFn: async (): Promise<ContributedStoreCatalogData> => {
			if (!(spec && source && path)) {
				return { items: [], total: null };
			}
			if (!isCoreApiPath(path)) {
				throw new Error(`store tab source path must start with /api/: ${path}`);
			}
			const response = await fetch(apiUrl(target, path), {
				method: source.http.method ?? "GET",
				headers: makeHeaders(target.token),
			});
			if (!response.ok) {
				throw new Error(`${path} failed: ${response.status}`);
			}
			const payload = (await response.json()) as unknown;
			return {
				items: storeItemsFromResponse(spec, payload),
				total: storeTotalFromResponse(spec, payload),
			};
		},
	};
}

/** Read one app-registered Store tab through the host's authenticated Core seam. */
export function useContributedStoreCatalog(
	tab: PluginStoreTab,
	enabled = tab.app_enabled
) {
	const node = useActiveNode();
	const target = toTarget(node);
	return useQuery(contributedStoreCatalogQuery(tab, target, enabled));
}
