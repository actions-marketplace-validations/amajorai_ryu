import { useQuery } from "@tanstack/react-query";
import {
	fetchEntitlementStatus,
	hasBillingAuth,
	type SubscriptionStatus,
} from "@/src/lib/api/billing.ts";
import {
	hasOrgAuth,
	listOrgs,
	type OrgListEntry,
	useActiveOrgId,
} from "@/src/lib/api/orgs.ts";
import { orgScopeKey, planTierForOrg } from "@/src/lib/org-billing.ts";
import { queryClient as appQueryClient } from "@/src/lib/query-client.ts";

const ORG_LIST_KEY = ["settings", "orgs"] as const;
const ORG_BILLING_STATUS_KEY = ["billing-status-org"] as const;

export interface OrgBillingStatus {
	activeOrgId: string | null;
	billing: SubscriptionStatus | null;
	loading: boolean;
	organization: OrgListEntry | null;
	plan: ReturnType<typeof planTierForOrg>;
}

/**
 * Resolve the org identity and the org-owned plan from the same app-wide cache
 * used by the Services picker. The status endpoint resolves the active org on
 * the server; the org id is therefore a cache/safety key, not a query argument.
 */
export function useOrgBillingStatus(): OrgBillingStatus {
	const activeOrgId = useActiveOrgId();
	const orgsQuery = useQuery(
		{
			enabled: hasOrgAuth(),
			queryFn: listOrgs,
			queryKey: ORG_LIST_KEY,
		},
		appQueryClient
	);
	const organizations = orgsQuery.data ?? [];
	const fallbackOrgId = organizations[0]?.id ?? null;
	const resolvedOrgId = activeOrgId ?? fallbackOrgId;
	const billingQuery = useQuery(
		{
			enabled:
				hasBillingAuth() && (Boolean(resolvedOrgId) || orgsQuery.isFetched),
			queryFn: fetchEntitlementStatus,
			queryKey: [
				...ORG_BILLING_STATUS_KEY,
				orgScopeKey(activeOrgId, fallbackOrgId),
			],
			staleTime: 30_000,
		},
		appQueryClient
	);

	return {
		activeOrgId: resolvedOrgId,
		billing: billingQuery.data ?? null,
		loading: orgsQuery.isPending || billingQuery.isPending,
		organization:
			organizations.find((org) => org.id === resolvedOrgId) ??
			organizations[0] ??
			null,
		plan: planTierForOrg(billingQuery.data, resolvedOrgId),
	};
}
