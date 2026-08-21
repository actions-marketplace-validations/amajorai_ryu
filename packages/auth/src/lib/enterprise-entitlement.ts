import {
	EnterpriseEntitlement,
	type EnterpriseLicenseStatus,
} from "@ryu/db/models/enterprise-entitlement.model";
import { env } from "@ryu/env/server";
import {
	ENTERPRISE_CAPABILITIES,
	type EnterpriseCapability,
	isEnterpriseGrantActive,
	normalizeEnterpriseCapabilities,
} from "./enterprise-entitlement-policy.ts";
import { verifySelfHostedEnterpriseLicense } from "./enterprise-license.ts";

export type { EnterpriseCapability } from "./enterprise-entitlement-policy.ts";
export {
	ENTERPRISE_CAPABILITIES,
	isEnterpriseGrantActive,
	normalizeEnterpriseCapabilities,
};

export interface EnterpriseAccess {
	capabilities: EnterpriseCapability[];
	expiresAt: Date | null;
	plan: "enterprise" | "enterprise-plus" | "dedicated" | null;
	source: "contract" | "development" | "self-host-license" | null;
	status: EnterpriseLicenseStatus | null;
}

function parseDevelopmentOrganizationIds(): Set<string> {
	if (env.NODE_ENV === "production") {
		return new Set();
	}
	return new Set(
		(env.RYU_ENTERPRISE_ORG_IDS ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean)
	);
}

function emptyAccess(): EnterpriseAccess {
	return {
		capabilities: [],
		expiresAt: null,
		plan: null,
		source: null,
		status: null,
	};
}

/** Resolve the active organization-level enterprise grant. Fail closed. */
export async function resolveEnterpriseAccess(
	organizationId: string
): Promise<EnterpriseAccess> {
	if (parseDevelopmentOrganizationIds().has(organizationId)) {
		return {
			capabilities: [...ENTERPRISE_CAPABILITIES],
			expiresAt: null,
			plan: "enterprise",
			source: "development",
			status: "active",
		};
	}

	try {
		const entitlement = await EnterpriseEntitlement.findOne({
			organizationId,
		})
			.lean()
			.exec();
		if (!entitlement) {
			const license = verifySelfHostedEnterpriseLicense(
				env.RYU_ENTERPRISE_LICENSE,
				env.RYU_ENTERPRISE_LICENSE_PUBLIC_KEY
			);
			if (license?.organizationId === organizationId) {
				return {
					capabilities: license.capabilities,
					expiresAt: license.expiresAt,
					plan: license.plan,
					source: "self-host-license",
					status: "active",
				};
			}
			return emptyAccess();
		}

		const expiresAt = entitlement.expiresAt
			? new Date(entitlement.expiresAt)
			: null;
		const active = isEnterpriseGrantActive(
			entitlement.status,
			expiresAt,
			new Date()
		);
		if (!active) {
			return {
				capabilities: [],
				expiresAt,
				plan: entitlement.plan ?? null,
				source: entitlement.source ?? null,
				status: entitlement.status ?? null,
			};
		}

		return {
			capabilities: normalizeEnterpriseCapabilities(entitlement.capabilities),
			expiresAt,
			plan: entitlement.plan ?? null,
			source: entitlement.source ?? null,
			status: entitlement.status ?? null,
		};
	} catch (error) {
		console.error(
			"[enterprise] failed to resolve organization entitlement; denying access:",
			error
		);
		return emptyAccess();
	}
}

export async function hasEnterpriseCapability(
	organizationId: string,
	capability: EnterpriseCapability
): Promise<boolean> {
	const access = await resolveEnterpriseAccess(organizationId);
	return access.capabilities.includes(capability);
}
