import { queryOptions } from "@tanstack/react-query";
import type { ApiTarget } from "./api/client.ts";
import { fetchSpaces } from "./api/spaces.ts";
/** One node/credential-scoped list shared by Spaces and explicit-target panels. */
export function spaceListQueryOptions(target: ApiTarget) {
	const scoped = {
		...target,
		token: target.token ?? null,
		userJwt: target.userJwt ?? null,
	};
	return queryOptions({
		queryKey: [
			"desktop-spaces",
			scoped.url,
			scoped.token,
			scoped.userJwt,
		] as const,
		queryFn: ({ signal }) => fetchSpaces(scoped, signal),
		staleTime: 30_000,
		retry: false,
	});
}
