import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSpacesContext } from "@/src/contexts/SpacesContext.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useSidebarSectionSources } from "@/src/hooks/useSidebarSectionSource.ts";
import { listOutputStyles } from "@/src/lib/api/output-styles.ts";
import type { PluginSidebarSection } from "@/src/lib/api/plugins.ts";
import {
	buildContributedMentionSources,
	buildOutputStyleMentionSources,
	buildSpacePageMentionSources,
} from "@/src/lib/mentions/resources.ts";
import { queryClient } from "@/src/lib/query-client.ts";
import { spaceDocumentListQueryOptions } from "@/src/lib/space-document-list-query.ts";

/** The dynamic resources added to the shared chat @ directory. */
export interface MentionableResources {
	appItems: ReturnType<typeof buildContributedMentionSources>;
	outputStyles: ReturnType<typeof buildOutputStyleMentionSources>;
	pages: ReturnType<typeof buildSpacePageMentionSources>;
}

/**
 * Join the existing host-owned list bridges to the chat mention directory.
 *
 * Sidebar-section queries intentionally come from `useSidebarSectionSources`, so
 * Chat, Sidebar, and Library share the same React Query cache and response mapper.
 * Space documents and personality profiles use the same active-node cache boundary as their
 * existing surfaces; a missing/old endpoint simply contributes no candidates.
 */
export function useMentionableResources(
	sections: PluginSidebarSection[]
): MentionableResources {
	const activeNode = useActiveNode();
	const {
		error: spacesError,
		documentRevisions,
		loading: spacesLoading,
		spaces,
	} = useSpacesContext();
	const contributedSourceData = useSidebarSectionSources(sections);
	const documentQueries = useQueries(
		{
			queries: spaces.map((space) => ({
				...spaceDocumentListQueryOptions(
					{
						url: activeNode.url,
						token: activeNode.token ?? null,
						userJwt: activeNode.userJwt ?? null,
					},
					space.id,
					documentRevisions.get(space.id) ?? 0
				),
				enabled: !(spacesLoading || spacesError),
			})),
		},
		queryClient
	);
	const { data: outputStyleData } = useQuery({
		queryFn: () =>
			listOutputStyles({
				token: activeNode.token ?? null,
				userJwt: activeNode.userJwt ?? null,
				url: activeNode.url,
			}),
		queryKey: [
			"output-styles",
			activeNode.url,
			activeNode.token ?? null,
			activeNode.userJwt ?? null,
		],
		retry: false,
		staleTime: 30_000,
	});

	return useMemo(
		() => ({
			appItems: buildContributedMentionSources(contributedSourceData),
			outputStyles: buildOutputStyleMentionSources(
				outputStyleData?.styles ?? []
			),
			pages: buildSpacePageMentionSources(
				spaces,
				documentQueries.map((query) => query.data ?? [])
			),
		}),
		[contributedSourceData, documentQueries, outputStyleData?.styles, spaces]
	);
}
