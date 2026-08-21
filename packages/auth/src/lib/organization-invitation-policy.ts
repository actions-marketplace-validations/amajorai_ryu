export const ORGANIZATION_INVITATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface InvitationPolicySnapshot {
	blockedAt?: Date | null;
	cooldownUntil?: Date | null;
}

export type InvitationPolicyDecision =
	| { allowed: true }
	| { allowed: false; reason: "blocked" | "cooldown"; retryAfterMs?: number };

export function normalizeInvitationEmail(value: string): string {
	return value.trim().toLowerCase();
}

export function normalizeReferralTag(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const tag = value.trim().replace(/^#/, "");
	return tag ? tag.slice(0, 80) : undefined;
}

export function invitationPolicyDecision(
	policy: InvitationPolicySnapshot | null | undefined,
	nowMs = Date.now()
): InvitationPolicyDecision {
	if (policy?.blockedAt) {
		return { allowed: false, reason: "blocked" };
	}
	const cooldownUntilMs = policy?.cooldownUntil?.getTime() ?? 0;
	if (cooldownUntilMs > nowMs) {
		return {
			allowed: false,
			reason: "cooldown",
			retryAfterMs: cooldownUntilMs - nowMs,
		};
	}
	return { allowed: true };
}
