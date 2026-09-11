// Node-scoped on-demand audit. Core runs the selected agent through its normal
// chat boundary; the static scorecard remains separate from its assessment.

import type {
	CatalogScanInput,
	CatalogScanResult,
} from "@ryu/marketplace/catalog/host";
import { ApiError, type ApiTarget, request } from "./client.ts";

const CATALOG_SCAN_PATH = "/api/catalog/scan";

interface CatalogScanWireResult {
	agent_id: string;
	assessment?: CatalogScanResult["assessment"];
	auditedAt?: string;
	conversationId?: string;
	model?: string;
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
			body: { ...input, execution: "agent" },
			method: "POST",
		}
	).catch((error: unknown) => {
		if (error instanceof ApiError && error.serverMessage) {
			throw new Error(error.serverMessage, { cause: error });
		}
		throw error;
	});
	return {
		agentId: result.agent_id,
		conversationId: result.conversationId,
		assessment: result.assessment,
		model: result.model,
		auditedAt: result.auditedAt,
		report: result.report,
		status: result.status,
	};
}
