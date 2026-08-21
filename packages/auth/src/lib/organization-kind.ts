import { Member, Organization } from "@ryu/db/models/control-plane.model";
import { businessEmailDomainDecision } from "./organization-email-policy.ts";

export const ORGANIZATION_KIND_KEY = "organizationKind" as const;
export const PERSONAL_ORGANIZATION_KIND = "personal" as const;
export const TEAMS_ORGANIZATION_KIND = "teams" as const;

const BA_OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export type OrganizationKind =
	| typeof PERSONAL_ORGANIZATION_KIND
	| typeof TEAMS_ORGANIZATION_KIND;

export function parseOrganizationMetadata(
	metadata: unknown
): Record<string, unknown> {
	if (typeof metadata === "string") {
		try {
			const parsed: unknown = JSON.parse(metadata);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	return metadata && typeof metadata === "object" && !Array.isArray(metadata)
		? (metadata as Record<string, unknown>)
		: {};
}

export function organizationKindFromMetadata(
	metadata: unknown
): OrganizationKind | null {
	const value = parseOrganizationMetadata(metadata)[ORGANIZATION_KIND_KEY];
	return value === PERSONAL_ORGANIZATION_KIND ||
		value === TEAMS_ORGANIZATION_KIND
		? value
		: null;
}

export function metadataWithOrganizationKind(
	metadata: unknown,
	kind: OrganizationKind,
	extra: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		...parseOrganizationMetadata(metadata),
		...extra,
		[ORGANIZATION_KIND_KEY]: kind,
	};
}

async function setOrganizationKind(
	organizationId: string,
	kind: OrganizationKind,
	extra: Record<string, unknown> = {}
): Promise<boolean> {
	if (!BA_OBJECT_ID_RE.test(organizationId)) {
		return false;
	}
	const organization = await Organization.findById(organizationId)
		.select("metadata")
		.lean<{ metadata?: unknown }>();
	if (!organization) {
		return false;
	}
	if (organizationKindFromMetadata(organization.metadata) === kind) {
		return true;
	}

	const metadata = metadataWithOrganizationKind(
		organization.metadata,
		kind,
		extra
	);
	await Organization.updateOne(
		{ _id: organizationId },
		{ $set: { metadata: JSON.stringify(metadata) } }
	);
	return true;
}

/**
 * A completed change from a personal mailbox to a company-domain mailbox also
 * changes the org boundary. This keeps a company address from remaining on a
 * personal org before the customer reaches checkout; it preserves the same
 * organization id and does not imply that a paid Teams subscription exists.
 */
export async function promotePersonalOrganizationForBusinessEmail(
	userId: string,
	email: string
): Promise<boolean> {
	if (!businessEmailDomainDecision(email).allowed) {
		return false;
	}
	const firstMember = await Member.findOne({ userId })
		.sort({ createdAt: 1 })
		.select("organizationId")
		.lean<{ organizationId: unknown }>();
	if (!firstMember) {
		return false;
	}
	return setOrganizationKind(String(firstMember.organizationId), "teams", {
		organizationKindSource: "business_email",
		organizationKindChangedAt: new Date().toISOString(),
	});
}

/**
 * Convert the original personal org into a Teams org after Polar confirms the
 * paid subscription. The id and all data remain unchanged; only the durable
 * organization-kind marker changes, so membership and wallets keep their
 * existing ownership boundary.
 */
export async function promoteOrganizationToTeams(
	organizationId: string
): Promise<boolean> {
	// Better Auth stores organization ids as ObjectIds. Test doubles and
	// pre-control-plane webhook fixtures may carry symbolic ids; they are not a
	// reason to turn an otherwise valid payment webhook into a retry storm.
	return setOrganizationKind(organizationId, TEAMS_ORGANIZATION_KIND, {
		upgradedFromPersonalAt: new Date().toISOString(),
	});
}
