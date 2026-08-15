// apps/desktop/src/pages/UsagePage.tsx
//
// Container for the Usage settings tab. Mirrors `CreditsPage.tsx`: this file
// loads and maps, `@ryu/blocks/desktop/usage` renders. The split is what lets
// `apps/storyboard` show the same surface with mock data.

import { UsageView } from "@ryu/blocks/desktop/usage";
import { useMemo } from "react";
import { useUsageStatement } from "@/src/hooks/useUsageStatement.ts";

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
		<UsageView
			errorMessage={error?.message ?? null}
			hasMore={hasMore}
			loading={loading}
			loadingMore={loadingMore}
			onLoadMore={loadMore}
			onRefresh={refresh}
			rows={rows}
			summary={
				stats
					? {
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
	);
}
