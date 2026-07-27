// apps/desktop/src/hooks/useSellerReports.ts
//
// Seller-org inbox for quality reports on hosted marketplace listings.

import type { SellerReportsState } from "@ryu/marketplace/host";
import { useCallback, useState } from "react";
import {
	fetchSellerReports,
	hasMarketplaceAuth,
	type MarketplaceError,
	type MarketplaceReportView,
	resolveReport,
} from "@/src/lib/api/marketplace.ts";

function toHostError(e: unknown): SellerReportsState["error"] {
	const err = e as MarketplaceError;
	if (err?.kind) {
		return { kind: err.kind, message: err.message };
	}
	return {
		kind: "unknown",
		message: e instanceof Error ? e.message : "Could not load reports",
	};
}

export function useSellerReports(): SellerReportsState {
	const [reports, setReports] = useState<MarketplaceReportView[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<SellerReportsState["error"]>(null);
	const authed = hasMarketplaceAuth();

	const refresh = useCallback(async () => {
		if (!authed) {
			setReports([]);
			return;
		}
		setLoading(true);
		try {
			const next = await fetchSellerReports();
			setReports(next);
			setError(null);
		} catch (e) {
			setReports([]);
			setError(toHostError(e));
		} finally {
			setLoading(false);
		}
	}, [authed]);

	const resolve = useCallback(
		async (input: {
			id: string;
			note?: string | null;
			status: "resolved" | "dismissed" | "reviewing" | "open";
		}) => {
			await resolveReport(input);
		},
		[]
	);

	return {
		authed,
		error,
		loading,
		refresh,
		reports: reports.map((r) => ({
			id: r.id,
			itemId: r.itemId,
			itemKind: r.itemKind,
			itemName: r.itemName,
			reason: r.reason,
			details: r.details,
			status: r.status,
		})),
		resolve,
	};
}
