import { describe, expect, it } from "bun:test";
import {
	ENTERPRISE_CAPABILITIES,
	isEnterpriseGrantActive,
	normalizeEnterpriseCapabilities,
} from "./enterprise-entitlement-policy.ts";

describe("enterprise entitlement policy", () => {
	it("keeps only known capabilities and preserves their order", () => {
		expect(
			normalizeEnterpriseCapabilities([
				"enterprise.scim",
				"not-a-capability",
				"enterprise.sso.oidc",
			])
		).toEqual(["enterprise.scim", "enterprise.sso.oidc"]);
		expect(ENTERPRISE_CAPABILITIES).toContain("enterprise.sso.saml");
	});

	it("fails closed for suspended and expired grants", () => {
		const now = new Date("2026-08-19T00:00:00.000Z");
		expect(isEnterpriseGrantActive("suspended", null, now)).toBe(false);
		expect(
			isEnterpriseGrantActive(
				"active",
				new Date("2026-08-18T23:59:59.000Z"),
				now
			)
		).toBe(false);
	});

	it("accepts active and trialing grants before expiry", () => {
		const now = new Date("2026-08-19T00:00:00.000Z");
		const expiresAt = new Date("2026-08-20T00:00:00.000Z");
		expect(isEnterpriseGrantActive("active", expiresAt, now)).toBe(true);
		expect(isEnterpriseGrantActive("trialing", expiresAt, now)).toBe(true);
	});
});
