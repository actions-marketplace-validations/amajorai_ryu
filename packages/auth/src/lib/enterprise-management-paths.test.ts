import { describe, expect, it } from "bun:test";
import { isRawEnterpriseIdentityManagementPath } from "./enterprise-management-paths.ts";

describe("enterprise identity management boundary", () => {
	it("blocks Better Auth provider-management endpoints", () => {
		expect(
			isRawEnterpriseIdentityManagementPath("/api/auth/sso/register")
		).toBe(true);
		expect(
			isRawEnterpriseIdentityManagementPath("/api/auth/sso/providers/")
		).toBe(true);
		expect(
			isRawEnterpriseIdentityManagementPath(
				"/api/auth/scim/delete-provider-connection"
			)
		).toBe(true);
	});

	it("leaves protocol sign-in and provisioning endpoints available", () => {
		expect(isRawEnterpriseIdentityManagementPath("/api/auth/sign-in/sso")).toBe(
			false
		);
		expect(
			isRawEnterpriseIdentityManagementPath("/api/auth/scim/v2/Users")
		).toBe(false);
	});
});
