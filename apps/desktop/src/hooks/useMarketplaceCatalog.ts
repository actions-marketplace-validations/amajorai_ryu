// apps/desktop/src/hooks/useMarketplaceCatalog.ts
//
// Browses the Ryu Marketplace catalog WITH pricing from the control-plane server
// (lib/api/marketplace.ts -> :3000). This is the only desktop surface that sees
// per-item pricing — the Core catalog adapter strips it — so the Buy / price
// affordances key off this list. Plain state + debounced query, mirroring the
// other :3000-targeted hooks (outside the node-scoped TanStack cache).

import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchCatalog,
	type MarketplaceCard,
	type MarketplaceError,
	type MarketplaceKind,
} from "@/src/lib/api/marketplace.ts";

const DEBOUNCE_MS = 300;

interface UseMarketplaceCatalog {
	error: MarketplaceError | null;
	items: MarketplaceCard[];
	kind: MarketplaceKind;
	loading: boolean;
	query: string;
	refresh: () => Promise<void>;
	setKind: (kind: MarketplaceKind) => void;
	setQuery: (query: string) => void;
}

export function useMarketplaceCatalog(
	initialKind: MarketplaceKind = "skill",
	initialQuery = ""
): UseMarketplaceCatalog {
	const [kind, setKind] = useState<MarketplaceKind>(initialKind);
	const [query, setQuery] = useState(initialQuery);
	const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
	const [items, setItems] = useState<MarketplaceCard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<MarketplaceError | null>(null);
	const activeRequestRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
		return () => clearTimeout(id);
	}, [query]);

	const load = useCallback(async () => {
		activeRequestRef.current?.abort();
		const controller = new AbortController();
		activeRequestRef.current = controller;
		setLoading(true);
		try {
			const data = await fetchCatalog(kind, debouncedQuery, controller.signal);
			if (controller.signal.aborted) {
				return;
			}
			setItems(data);
			setError(null);
		} catch (e) {
			if (controller.signal.aborted) {
				return;
			}
			setItems([]);
			setError(e as MarketplaceError);
		} finally {
			if (activeRequestRef.current === controller) {
				activeRequestRef.current = null;
				setLoading(false);
			}
		}
	}, [kind, debouncedQuery]);

	useEffect(() => {
		load().catch(() => undefined);
		return () => {
			activeRequestRef.current?.abort();
			activeRequestRef.current = null;
		};
	}, [load]);

	const refresh = useCallback(() => load(), [load]);

	return {
		kind,
		setKind,
		query,
		setQuery,
		items,
		loading,
		error,
		refresh,
	};
}
