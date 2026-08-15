// apps/desktop/src/hooks/useUsageStatement.ts
//
// The org's credit usage statement, from the control plane (lib/api/credits.ts).
//
// Plain state + manual refresh, NOT TanStack Query — the same reasoning as
// `useCreditsWallet`: this targets :3000 (session-authed) rather than the active
// Core node, so it sits outside the node-scoped query cache every other hook in
// this app shares. Using `useQuery` here would key a control-plane read against a
// node URL that has nothing to do with it.

import { useCallback, useEffect, useState } from "react";
import {
	type CreditsError,
	fetchUsage,
	type LedgerEntry,
	type UsageFilters,
	type UsageStats,
} from "@/src/lib/api/credits.ts";

export interface UseUsageStatement {
	/** Apply a new filter set, resetting to the first page. */
	applyFilters: (filters: UsageFilters) => void;
	entries: LedgerEntry[];
	error: CreditsError | null;
	filters: UsageFilters;
	/** True while the first page (or a re-filtered first page) is loading. */
	loading: boolean;
	/** True while an additional page is being appended. */
	loadingMore: boolean;
	/** Fetch the next page and append it. No-op when exhausted. */
	loadMore: () => void;
	/** Whether another page exists. */
	hasMore: boolean;
	refresh: () => void;
	stats: UsageStats | null;
}

const PAGE_SIZE = 50;

export function useUsageStatement(): UseUsageStatement {
	const [filters, setFilters] = useState<UsageFilters>({});
	const [entries, setEntries] = useState<LedgerEntry[]>([]);
	const [stats, setStats] = useState<UsageStats | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<CreditsError | null>(null);

	const load = useCallback(async (next: UsageFilters) => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetchUsage({ ...next, limit: PAGE_SIZE });
			setEntries(res.entries);
			setStats(res.stats);
			setCursor(res.nextCursor);
		} catch (err) {
			setError(err as CreditsError);
		} finally {
			setLoading(false);
		}
	}, []);

	const loadMore = useCallback(() => {
		if (!cursor || loadingMore) {
			return;
		}
		setLoadingMore(true);
		fetchUsage({ ...filters, before: cursor, limit: PAGE_SIZE })
			.then((res) => {
				setEntries((prev) => [...prev, ...res.entries]);
				setCursor(res.nextCursor);
			})
			.catch((err) => setError(err as CreditsError))
			.finally(() => setLoadingMore(false));
	}, [cursor, filters, loadingMore]);

	const applyFilters = useCallback(
		(next: UsageFilters) => {
			setFilters(next);
			setCursor(null);
			setEntries([]);
			void load(next);
		},
		[load]
	);

	const refresh = useCallback(() => {
		setCursor(null);
		void load(filters);
	}, [filters, load]);

	useEffect(() => {
		void load({});
	}, [load]);

	return {
		entries,
		stats,
		filters,
		loading,
		loadingMore,
		hasMore: cursor !== null,
		error,
		applyFilters,
		loadMore,
		refresh,
	};
}
