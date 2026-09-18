// Live usage for every saved Ryu provider subscription account.
//
// The catalog is the source of truth for which provider/account rows exist. Each
// query is keyed by the node, provider, and sealed-vault account id, so switching
// nodes cannot reuse a snapshot from another machine and switching accounts does
// not require mutating the active Pi configuration.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useIsActiveTab } from "@/src/contexts/TabsContext.tsx";
import { toTarget } from "@/src/lib/api/client.ts";
import type {
	PiAccount,
	PiCatalog,
	PiProvider,
} from "@/src/lib/api/pi-config.ts";
import type { UsageSnapshot } from "@/src/lib/api/usage.ts";
import { fetchProviderAccountUsage } from "@/src/lib/api/usage.ts";
import { useActiveNode } from "./useActiveNode.ts";

const FIVE_MINUTES_MS = 1000 * 60 * 5;

interface SubscriptionAccountRef {
	account: PiAccount;
	provider: PiProvider;
}

export interface SubscriptionUsageAccount {
	accountId: string;
	accountLabel: string;
	active: boolean;
	category: string;
	error: string | null;
	gatewayActive: boolean;
	kind: string;
	loading: boolean;
	providerId: string;
	providerLabel: string;
	snapshot: UsageSnapshot | null;
}

export interface UseSubscriptionUsageResult {
	accounts: SubscriptionUsageAccount[];
	refresh: () => void;
	refreshing: boolean;
}

function subscriptionAccountRefs(
	catalog: PiCatalog | null
): SubscriptionAccountRef[] {
	if (!catalog) {
		return [];
	}
	const refs: SubscriptionAccountRef[] = [];
	for (const provider of catalog.providers) {
		if (provider.authKind !== "subscription" || provider.managed) {
			continue;
		}
		for (const account of provider.accounts ?? []) {
			refs.push({ account, provider });
		}
	}
	return refs;
}

export function useSubscriptionUsage(
	catalog: PiCatalog | null
): UseSubscriptionUsageResult {
	const active = useIsActiveTab();
	const node = useActiveNode();
	const target = useMemo(
		() => toTarget(node),
		[node.token, node.url, node.userJwt]
	);
	const queryClient = useQueryClient();
	const refs = useMemo(() => subscriptionAccountRefs(catalog), [catalog]);
	const queries = useMemo(
		() =>
			refs.map(({ account, provider }) => ({
				enabled: active && account.kind === "oauth",
				queryFn: ({ signal }: { signal: AbortSignal }) =>
					fetchProviderAccountUsage(
						target,
						provider.id,
						account.accountId,
						signal
					),
				queryKey: [
					"provider-account-usage",
					node.url,
					node.token ?? null,
					node.userJwt ?? null,
					provider.id,
					account.accountId,
				],
				refetchInterval: FIVE_MINUTES_MS,
				refetchOnWindowFocus: true,
				staleTime: FIVE_MINUTES_MS,
			})),
		[active, node.token, node.url, node.userJwt, refs, target]
	);
	const results = useQueries({ subscribed: active, queries });

	const accounts = refs.map(({ account, provider }, index) => {
		const query = results[index];
		return {
			accountId: account.accountId,
			accountLabel: account.label,
			active: account.active,
			category: provider.label.replace(/\s*\([^)]*\)\s*$/, "").trim(),
			gatewayActive: account.gatewayActive === true,
			kind: account.kind,
			loading: query?.isLoading ?? false,
			providerId: provider.id,
			providerLabel: provider.label,
			snapshot: query?.data ?? null,
			error:
				query?.error instanceof Error
					? query.error.message
					: query?.error
						? "Unable to refresh this account."
						: null,
		};
	});

	const refresh = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: [
				"provider-account-usage",
				node.url,
				node.token ?? null,
				node.userJwt ?? null,
			],
		});
	}, [node.url, node.token, node.userJwt, queryClient]);

	return {
		accounts,
		refresh,
		refreshing: results.some((query) => query.isFetching),
	};
}
