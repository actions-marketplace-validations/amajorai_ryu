// apps/desktop/src/hooks/useProviderCredits.ts
//
// A BYOK provider's remaining prepaid API credit, from Core
// (`/api/providers/:id/credits`). Mirrors `useAgentUsage`: a 5-minute
// stale-while-revalidate poll, never per turn, and gated so a provider with no
// readable balance costs nothing.
//
// The gate matters more here than for agents. The picker lists ~16 providers and
// the badge mounts per row, so without `supportsProviderCredits` opening the
// picker would fire a request per provider — most of them only to be told
// "unsupported". With it, at most three ever poll.
//
// `refetchOnWindowFocus` is safe to leave on: query-core runs it through
// `shouldFetchOn` → `isStale`, so the 5-minute `staleTime` bounds it and N
// mounted badges cannot burst N vendor calls on a single alt-tab.

import { useQuery } from "@tanstack/react-query";
import type { ProviderCreditsSnapshot } from "@/src/lib/api/provider-credits.ts";
import {
	fetchProviderCredits,
	supportsProviderCredits,
} from "@/src/lib/api/provider-credits.ts";
import { useActiveNode } from "./useActiveNode.ts";

const FIVE_MINUTES_MS = 1000 * 60 * 5;

/**
 * The credit snapshot for `providerId`, or `null` until the first load (or when
 * the provider exposes no balance).
 */
export function useProviderCredits(
	providerId: string | null
): ProviderCreditsSnapshot | null {
	const node = useActiveNode();
	const enabled = supportsProviderCredits(providerId);
	const { data } = useQuery({
		queryKey: ["provider-credits", node.url, providerId],
		queryFn: () =>
			fetchProviderCredits(
				{ url: node.url, token: node.token, userJwt: node.userJwt ?? null },
				providerId ?? ""
			),
		enabled,
		staleTime: FIVE_MINUTES_MS,
		refetchInterval: FIVE_MINUTES_MS,
		refetchOnWindowFocus: true,
	});
	return data ?? null;
}
