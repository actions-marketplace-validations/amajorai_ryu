// apps/desktop/src/pages/UsagePage.tsx
//
// Container for the Usage settings tab. Mirrors `CreditsPage.tsx`: this file
// loads and maps, `@ryu/blocks/desktop/usage` renders. The split is what lets
// `apps/storyboard` show the same surface with mock data.

import { UsageView } from "@ryu/blocks/desktop/usage";
import type {
	UsageAnalyticsData,
	UsageDateRange,
	UsageGranularity,
	UsageScope,
} from "@ryu/blocks/desktop/usage-analytics";
import { useEffect, useMemo, useState } from "react";
import { OrgBillingContext } from "@/src/components/billing/OrgBillingContext.tsx";
import { useUsageStatement } from "@/src/hooks/useUsageStatement.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import { useActiveOrgId } from "@/src/lib/api/orgs.ts";
import { fetchUsageAnalytics } from "@/src/lib/api/usage-analytics.ts";
import { isLocalNode, useNodeStore } from "@/src/store/useNodeStore.ts";

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function initialRange(): UsageDateRange {
	const to = addDays(startOfDay(new Date()), 1);
	return { from: addDays(to, -30), to };
}

function errorMessageFor(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Unable to load usage analytics.";
}

export default function UsageTab() {
	const {
		entries,
		stats,
		loading,
		loadingMore,
		hasMore,
		error,
		loadMore,
		refresh,
	} = useUsageStatement();
	const activeOrgId = useActiveOrgId();
	const getActiveNode = useNodeStore((state) => state.getActiveNode);
	const defaultNode = useNodeStore((state) => state.defaultNode);
	const nodes = useNodeStore((state) => state.nodes);
	const autoSelectedNode = useNodeStore((state) => state.autoSelectedNode);
	const activeNode = useMemo(
		() => getActiveNode(),
		[autoSelectedNode, defaultNode, getActiveNode, nodes]
	);
	const activeNodeTarget = useMemo(
		() => ({
			...toTarget(activeNode),
			local: isLocalNode(activeNode),
			managed: activeNode.managed,
		}),
		[activeNode]
	);
	const [analyticsScope, setAnalyticsScope] =
		useState<UsageScope>("organization");
	const [analyticsGranularity, setAnalyticsGranularity] =
		useState<UsageGranularity>("daily");
	const [analyticsRange, setAnalyticsRange] =
		useState<UsageDateRange>(initialRange);
	const [analyticsProvider, setAnalyticsProvider] = useState<string | null>(
		null
	);
	const [analyticsModel, setAnalyticsModel] = useState<string | null>(null);
	const [analytics, setAnalytics] = useState<UsageAnalyticsData | null>(null);
	const [analyticsLoading, setAnalyticsLoading] = useState(true);
	const [analyticsError, setAnalyticsError] = useState<string | null>(null);
	const [providerOptions, setProviderOptions] = useState<string[]>([]);
	const [modelOptions, setModelOptions] = useState<string[]>([]);
	const [analyticsRefreshNonce, setAnalyticsRefreshNonce] = useState(0);

	useEffect(() => {
		setAnalytics(null);
		setAnalyticsProvider(null);
		setAnalyticsModel(null);
		setProviderOptions([]);
		setModelOptions([]);
	}, [activeNodeTarget, activeOrgId, analyticsScope]);

	useEffect(() => {
		let cancelled = false;
		setAnalyticsLoading(true);
		setAnalyticsError(null);
		void fetchUsageAnalytics(
			{
				from: analyticsRange.from,
				granularity: analyticsGranularity,
				model: analyticsModel,
				provider: analyticsProvider,
				to: analyticsRange.to,
			},
			{
				activeNode: activeNodeTarget,
				activeOrgId,
				scope: analyticsScope,
			}
		)
			.then((next) => {
				if (cancelled) {
					return;
				}
				setAnalytics(next);
				setProviderOptions((previous) =>
					[...new Set([...previous, ...next.providerOptions])].sort()
				);
				setModelOptions((previous) =>
					[...new Set([...previous, ...next.modelOptions])].sort()
				);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setAnalyticsError(errorMessageFor(error));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setAnalyticsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeNodeTarget,
		activeOrgId,
		analyticsGranularity,
		analyticsModel,
		analyticsProvider,
		analyticsRange,
		analyticsScope,
		analyticsRefreshNonce,
	]);

	const refreshAll = () => {
		refresh();
		setAnalyticsRefreshNonce((nonce) => nonce + 1);
	};

	const rows = useMemo(
		() =>
			entries.map((entry) => ({
				id: entry.id,
				reason: entry.reason,
				// Formatted HERE, not in the block: the block is rendered by the
				// storyboard too, and a `toLocaleString` there would produce a
				// different string per machine and make visual diffs noisy.
				createdAtLabel: new Date(entry.createdAt).toLocaleString(),
				delta: entry.delta,
				isCredit: entry.delta > 0,
				balanceAfter: entry.balanceAfter,
				model: entry.model,
				provider: entry.provider,
				inputTokens: entry.inputTokens,
				outputTokens: entry.outputTokens,
				durationMs: entry.durationMs,
				taskLabel: entry.taskLabel,
			})),
		[entries]
	);

	return (
		<div className="space-y-4">
			<OrgBillingContext description="Credits stay scoped to the organization; usage analytics also include BYOK, self-hosted, and local traffic." />
			<UsageView
				analyticsDashboard={{
					analytics,
					granularity: analyticsGranularity,
					loading: analyticsLoading,
					model: analyticsModel,
					modelOptions,
					onGranularityChange: setAnalyticsGranularity,
					onModelChange: setAnalyticsModel,
					onProviderChange: setAnalyticsProvider,
					onRangeChange: setAnalyticsRange,
					onRefresh: refreshAll,
					onScopeChange: setAnalyticsScope,
					provider: analyticsProvider,
					providerOptions,
					range: analyticsRange,
					scope: analyticsScope,
				}}
				errorMessage={error?.message ?? analyticsError}
				hasMore={hasMore}
				loading={loading}
				loadingMore={loadingMore}
				onLoadMore={loadMore}
				onRefresh={refreshAll}
				rows={rows}
				summary={
					stats
						? {
								byModel: stats.byModel,
								byProvider: stats.byProvider,
								byReason: stats.byReason,
								spentMicroUsd: stats.spentMicroUsd,
								creditedMicroUsd: stats.creditedMicroUsd,
								inputTokens: stats.inputTokens,
								outputTokens: stats.outputTokens,
								durationMs: stats.durationMs,
								transactions: stats.transactions,
							}
						: null
				}
			/>
		</div>
	);
}
