import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	listMentionTargetUsers,
	type MentionTargetUser,
} from "@/src/lib/api/notifications.ts";
import type { MentionSourceItem } from "@/src/lib/mentions/types.ts";
import { userMentionVisual } from "@/src/lib/mentions/user-visuals.tsx";
import { useActiveNode } from "./useActiveNode.ts";

export interface UseHumanMentionDirectoryResult {
	error: string | null;
	loading: boolean;
	users: MentionSourceItem[];
}

function toMentionSource(user: MentionTargetUser): MentionSourceItem {
	return {
		description: user.email ?? undefined,
		id: user.id,
		name: user.name,
		visualIcon: userMentionVisual(user),
	};
}

/** Load the Inbox-gated human roster for the active node's org/team scope. */
export function useHumanMentionDirectory({
	enabled,
}: {
	enabled: boolean;
}): UseHumanMentionDirectoryResult {
	const node = useActiveNode();
	const query = useQuery({
		enabled: enabled && Boolean(node.url),
		queryFn: () =>
			listMentionTargetUsers({
				token: node.token,
				userJwt: node.userJwt ?? null,
				url: node.url,
			}),
		queryKey: [
			"human-mention-directory",
			node.url,
			node.token ?? null,
			enabled,
		],
	});
	const users = useMemo(
		() => (query.data ?? []).map(toMentionSource),
		[query.data]
	);
	return {
		error: query.error instanceof Error ? query.error.message : null,
		loading: enabled && query.isLoading,
		users,
	};
}
