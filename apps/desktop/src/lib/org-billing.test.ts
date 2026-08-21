import { describe, expect, test } from "bun:test";
import { orgScopeKey, planTierForOrg } from "./org-billing.ts";

describe("organization billing context", () => {
	test("keys reads by the active organization and falls back to membership order", () => {
		expect(orgScopeKey("org-a", "org-b")).toBe("org-a");
		expect(orgScopeKey(null, "org-b")).toBe("org-b");
		expect(orgScopeKey(null, null)).toBe("unscoped");
	});

	test("returns an org plan only for matching org billing status", () => {
		expect(
			planTierForOrg(
				{ organizationId: "org-a", plan: "teams", scope: "org" },
				"org-a"
			)
		).toBe("teams");
		expect(
			planTierForOrg(
				{ organizationId: "org-a", plan: "teams", scope: "org" },
				"org-b"
			)
		).toBeNull();
		expect(planTierForOrg({ plan: "pro", scope: "user" }, "org-a")).toBeNull();
	});
});
