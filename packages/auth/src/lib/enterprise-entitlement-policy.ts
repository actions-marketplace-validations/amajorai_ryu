export const ENTERPRISE_CAPABILITIES = [
	"enterprise.sso.oidc",
	"enterprise.sso.saml",
	"enterprise.scim",
	"enterprise.audit.export",
	"enterprise.deployment.dedicated",
	"enterprise.data.region",
] as const;

export type EnterpriseCapability = (typeof ENTERPRISE_CAPABILITIES)[number];
export type EnterpriseGrantStatus =
	| "active"
	| "expired"
	| "suspended"
	| "trialing";

const ENTERPRISE_CAPABILITY_SET = new Set<string>(ENTERPRISE_CAPABILITIES);

export function normalizeEnterpriseCapabilities(
	value: unknown
): EnterpriseCapability[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(
		(capability): capability is EnterpriseCapability =>
			typeof capability === "string" &&
			ENTERPRISE_CAPABILITY_SET.has(capability)
	);
}

export function isEnterpriseGrantActive(
	status: EnterpriseGrantStatus,
	expiresAt: Date | null,
	now = new Date()
): boolean {
	return (
		(status === "active" || status === "trialing") &&
		(!expiresAt || expiresAt.getTime() > now.getTime())
	);
}
