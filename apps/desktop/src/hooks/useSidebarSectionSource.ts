// Shared data seam for app-registered sidebar sections.
//
// The sidebar and Library intentionally read the same contribution, query key,
// and response mapper. An app declares one `sidebar_sections[].spec.source`, and
// both surfaces get the same rows plus an authoritative total when the endpoint
// provides one. Keeping this here prevents a future app from having to register a
// second Library-specific feed just to participate in the host's collection view.

import {
	isCoreApiPath,
	type SourceItem,
	sourceItemsFromResponse,
	sourceTotalFromResponse,
} from "@ryu/app-host/views";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginSidebarSection } from "@/src/lib/api/plugins.ts";

const MIN_REFRESH_MS = 1000;

export interface SidebarSectionSourceData {
	contribution: PluginSidebarSection;
	error: Error | null;
	isLoading: boolean;
	rows: SourceItem[];
	total: number | null;
}

function queryForSection(
	section: PluginSidebarSection,
	target: ReturnType<typeof toTarget>
) {
	const source = section.spec?.source;
	const path = source?.http.path;
	const method = source?.http.method ?? "GET";
	const enabled = Boolean(source && path && isCoreApiPath(path));
	const refetchInterval: number | false =
		source?.refreshMs && source.refreshMs > 0
			? Math.max(source.refreshMs, MIN_REFRESH_MS)
			: false;
	return {
		enabled,
		queryKey: [
			"contributed-section-source",
			target.url,
			target.token,
			path ?? "",
			method,
		],
		retry: false,
		queryFn: async () => {
			if (!path) {
				return null;
			}
			const response = await fetch(apiUrl(target, path), {
				method,
				headers: makeHeaders(target.token),
			});
			return response.ok ? ((await response.json()) as unknown) : null;
		},
		refetchInterval,
	};
}

/** Read every enabled app section through one shared, cacheable source model. */
export function useSidebarSectionSources(
	sections: PluginSidebarSection[]
): SidebarSectionSourceData[] {
	const node = useActiveNode();
	const target = toTarget(node);
	const results = useQueries({
		queries: sections.map((section) => queryForSection(section, target)),
	});

	return useMemo(
		() =>
			sections.map((section, index) => {
				const source = section.spec?.source;
				const result = results[index];
				const payload = result?.data;
				return {
					contribution: section,
					error: result?.error instanceof Error ? result.error : null,
					isLoading: result?.isLoading ?? false,
					rows:
						source && payload !== null && payload !== undefined
							? sourceItemsFromResponse(source, payload)
							: [],
					total:
						source && payload !== null && payload !== undefined
							? sourceTotalFromResponse(source, payload)
							: null,
				};
			}),
		[results, sections]
	);
}
