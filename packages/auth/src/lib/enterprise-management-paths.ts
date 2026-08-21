const RAW_ENTERPRISE_IDENTITY_MANAGEMENT_PATHS = new Set([
	"/api/auth/sso/register",
	"/api/auth/sso/providers",
	"/api/auth/sso/get-provider",
	"/api/auth/sso/update-provider",
	"/api/auth/sso/delete-provider",
	"/api/auth/sso/request-domain-verification",
	"/api/auth/sso/verify-domain",
	"/api/auth/scim/generate-token",
	"/api/auth/scim/list-provider-connections",
	"/api/auth/scim/get-provider-connection",
	"/api/auth/scim/delete-provider-connection",
]);

/** True for Better Auth identity-management endpoints owned by Ryu's API. */
export function isRawEnterpriseIdentityManagementPath(path: string): boolean {
	return RAW_ENTERPRISE_IDENTITY_MANAGEMENT_PATHS.has(path.replace(/\/+$/, ""));
}
