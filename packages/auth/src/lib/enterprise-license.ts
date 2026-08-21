import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
	type EnterpriseCapability,
	normalizeEnterpriseCapabilities,
} from "./enterprise-entitlement-policy.ts";

const MAX_LICENSE_LENGTH = 64 * 1024;
const LICENSE_AUDIENCE = "ryu-enterprise";

export interface SelfHostedEnterpriseLicense {
	capabilities: EnterpriseCapability[];
	expiresAt: Date | null;
	issuedAt: Date | null;
	licenseId: string | null;
	organizationId: string;
	plan: "enterprise" | "enterprise-plus" | "dedicated";
}

function decodeJson(value: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8")
		);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function unixDate(value: unknown): Date | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	const date = new Date(value * 1000);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Verify a vendor-signed self-host Enterprise license without network access. */
export function verifySelfHostedEnterpriseLicense(
	token: string | undefined,
	publicKey: string | undefined,
	now = new Date()
): SelfHostedEnterpriseLicense | null {
	if (!(token && publicKey) || token.length > MAX_LICENSE_LENGTH) {
		return null;
	}

	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}
	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	if (!(encodedHeader && encodedPayload && encodedSignature)) {
		return null;
	}
	const header = decodeJson(encodedHeader);
	const payload = decodeJson(encodedPayload);
	if (
		!(header && payload) ||
		header.alg !== "RS256" ||
		(header.typ !== undefined && header.typ !== "JWT")
	) {
		return null;
	}

	const organizationId = payload.organizationId;
	const plan = payload.plan;
	if (
		typeof organizationId !== "string" ||
		organizationId.length === 0 ||
		(plan !== "enterprise" &&
			plan !== "enterprise-plus" &&
			plan !== "dedicated")
	) {
		return null;
	}
	if (payload.aud !== undefined && payload.aud !== LICENSE_AUDIENCE) {
		return null;
	}
	if (payload.iss !== undefined && payload.iss !== "ryu") {
		return null;
	}

	const issuedAt = unixDate(payload.iat);
	const expiresAt = unixDate(payload.exp);
	const notBefore = unixDate(payload.nbf);
	if (
		(payload.iat !== undefined && issuedAt === null) ||
		(payload.exp !== undefined && expiresAt === null) ||
		(payload.nbf !== undefined && notBefore === null)
	) {
		return null;
	}
	if (expiresAt && expiresAt.getTime() <= now.getTime()) {
		return null;
	}
	if (notBefore && notBefore.getTime() > now.getTime()) {
		return null;
	}

	const capabilities = normalizeEnterpriseCapabilities(payload.capabilities);
	if (capabilities.length === 0) {
		return null;
	}

	try {
		const key = createPublicKey({
			key: publicKey.replaceAll("\\n", "\n"),
			format: "pem",
			type: "spki",
		});
		const valid = verifySignature(
			"RSA-SHA256",
			Buffer.from(`${encodedHeader}.${encodedPayload}`),
			key,
			Buffer.from(encodedSignature, "base64url")
		);
		if (!valid) {
			return null;
		}
	} catch {
		return null;
	}

	return {
		capabilities,
		expiresAt: expiresAt ?? null,
		issuedAt: issuedAt ?? null,
		licenseId: typeof payload.licenseId === "string" ? payload.licenseId : null,
		organizationId,
		plan,
	};
}
