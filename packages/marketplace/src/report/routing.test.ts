// packages/marketplace/src/report/routing.test.ts
//
// Pure routing rules for report audience (mirrors the control-plane resolve).

import { describe, expect, test } from "bun:test";
import type { ReportReason } from "./types.ts";

function resolveReportAudience(
	reason: ReportReason,
	sellerOrgId: string | null
): "platform" | "seller" | "both" {
	if (
		reason === "malicious" ||
		reason === "spam" ||
		reason === "inappropriate" ||
		reason === "ip"
	) {
		return "platform";
	}
	if (sellerOrgId && (reason === "broken" || reason === "other")) {
		return "both";
	}
	return "platform";
}

describe("report audience routing", () => {
	test("trust & safety always stays platform-only", () => {
		for (const reason of [
			"malicious",
			"spam",
			"inappropriate",
			"ip",
		] as const) {
			expect(resolveReportAudience(reason, "org_1")).toBe("platform");
			expect(resolveReportAudience(reason, null)).toBe("platform");
		}
	});

	test("broken/other with a seller org fans out to both", () => {
		expect(resolveReportAudience("broken", "org_1")).toBe("both");
		expect(resolveReportAudience("other", "org_1")).toBe("both");
	});

	test("broken/other without a seller stays platform (GitHub listings)", () => {
		expect(resolveReportAudience("broken", null)).toBe("platform");
		expect(resolveReportAudience("other", null)).toBe("platform");
	});
});
