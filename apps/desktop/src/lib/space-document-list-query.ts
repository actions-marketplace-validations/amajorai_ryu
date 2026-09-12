import {
	type QueryClient,
	QueryObserver,
	queryOptions,
} from "@tanstack/react-query";
import type { ApiTarget } from "./api/client.ts";
import { fetchDocuments } from "./api/spaces.ts";

/** Shared by folder/page reads and chat mentions, including document mutations. */
export function spaceDocumentListQueryOptions(
	target: ApiTarget,
	spaceId: string,
	revision: number
) {
	return queryOptions({
		queryKey: [
			"space-documents",
			target.url,
			target.token ?? null,
			target.userJwt ?? null,
			spaceId,
			revision,
		] as const,
		queryFn: ({ signal }) => fetchDocuments(target, spaceId, signal),
		staleTime: 30_000,
		gcTime: 60_000,
		retry: false,
	});
}

/** Keep imperative readers subscribed until their shared request settles. */
export async function fetchSpaceDocumentList(
	client: QueryClient,
	target: ApiTarget,
	spaceId: string,
	revision: number
) {
	const options = {
		...spaceDocumentListQueryOptions(target, spaceId, revision),
		staleTime: 0,
	};
	// Otherwise the last chat observer unmounting could abort an active folder read.
	const observer = new QueryObserver(client, { ...options, enabled: false });
	const unsubscribe = observer.subscribe(() => undefined);
	try {
		return await client.fetchQuery(options);
	} finally {
		unsubscribe();
	}
}
