// Node-scoped client for the catalog's deterministic-scorecard + agent review.
// The scorecard is computed in the shared marketplace package; Core only runs
// the configured read-only agent and returns its narrative report.

import type {
	CatalogScanInput,
	CatalogScanResult,
} from "@ryu/marketplace/catalog/host";
import { type ApiTarget, request } from "./client.ts";

const CATALOG_SCAN_PATH = "/api/catalog/scan";

interface CatalogScanWireResult {
	agent_id: string;
	report: string;
	status: CatalogScanResult["status"];
}

export const CATALOG_SCAN_AGENT_PREF = "security-scanner-agent";

export async function runCatalogScan(
	target: ApiTarget,
	input: CatalogScanInput
): Promise<CatalogScanResult> {
	const result = await request<CatalogScanWireResult>(
		target,
		CATALOG_SCAN_PATH,
		{
			body: input,
			method: "POST",
		}
	);
	return {
		agentId: result.agent_id,
		report: result.report,
		status: result.status,
	};
}
