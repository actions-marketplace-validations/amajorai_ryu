// Shared data seam for app-registered sidebar sections.
//
// The sidebar and Library intentionally read the same contribution, query key,
// and response mapper. An app declares one `sidebar_sections[].spec.source`, and
// both surfaces get the same rows plus an authoritative total when the endpoint
// provides one. Keeping this here prevents a future app from having to register a
// second Library-specific feed just to participate in the host's collection view.

import {
	contributionSourceRequest,
	DECLARATIVE_HTTP_GRANT,
	normalizeViewRefreshMs,
	type SourceItem,
	sourceItemsFromResponse,
	sourceTotalFromResponse,
} from "@ryu/app-host/views";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { apiUrl, makeHeaders, toTarget } from "@/src/lib/api/client.ts";
import type { PluginSidebarSection } from "@/src/lib/api/plugins.ts";

export function sectionSourceRequest(
	section: PluginSidebarSection
): { method: "GET"; path: string } | null {
	if (!(section.approved_grants ?? []).includes(DECLARATIVE_HTTP_GRANT)) {
		return null;
	}
	return contributionSourceRequest(section, section.spec?.source);
}

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
	const sourceRequest = sectionSourceRequest(section);
	const refreshMs = normalizeViewRefreshMs(source?.refreshMs);
	const refetchInterval: number | false = refreshMs ?? false;
	return {
		enabled: sourceRequest !== null,
		queryKey: [
			"contributed-section-source",
			target.url,
			target.token,
			sourceRequest?.path ?? "",
			sourceRequest?.method ?? "",
		],
		retry: false,
		queryFn: async () => {
			if (!sourceRequest) {
				return null;
			}
			const response = await fetch(apiUrl(target, sourceRequest.path), {
				method: sourceRequest.method,
				headers: makeHeaders(target.token, target.userJwt),
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
