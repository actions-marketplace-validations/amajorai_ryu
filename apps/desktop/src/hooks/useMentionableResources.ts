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
		listDocuments,
		loading: spacesLoading,
		spaces,
	} = useSpacesContext();
	const contributedSourceData = useSidebarSectionSources(sections);
	const documentQueries = useQueries({
		queries: spaces.map((space) => ({
			enabled: !(spacesLoading || spacesError),
			queryFn: () => listDocuments(space.id),
			queryKey: ["space-documents", activeNode.url, activeNode.token, space.id],
			retry: false,
			staleTime: 30_000,
		})),
	});
	const { data: outputStyleData } = useQuery({
		queryFn: () =>
			listOutputStyles({
				token: activeNode.token ?? null,
				url: activeNode.url,
			}),
		queryKey: ["output-styles", activeNode.url, activeNode.token],
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
