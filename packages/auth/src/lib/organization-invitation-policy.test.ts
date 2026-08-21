import { describe, expect, it } from "bun:test";
import {
	invitationPolicyDecision,
	normalizeInvitationEmail,
	normalizeReferralTag,
} from "./organization-invitation-policy.ts";

describe("organization invitation policy", () => {
	it("normalizes recipient email and referral tags", () => {
		expect(normalizeInvitationEmail("  Person@Example.COM ")).toBe(
			"person@example.com"
		);
		expect(normalizeReferralTag(" #campaign-42 ")).toBe("campaign-42");
		expect(normalizeReferralTag(42)).toBeUndefined();
	});

	it("permanently blocks a recipient before checking cooldown", () => {
		const decision = invitationPolicyDecision(
			{
				blockedAt: new Date(1000),
				cooldownUntil: new Date(99_000),
			},
			2000
		);
		expect(decision).toEqual({ allowed: false, reason: "blocked" });
	});

	it("enforces cooldown and allows invitations after it expires", () => {
		const cooldownUntil = new Date(10_000);
		expect(invitationPolicyDecision({ cooldownUntil }, 7500)).toEqual({
			allowed: false,
			reason: "cooldown",
			retryAfterMs: 2500,
		});
		expect(invitationPolicyDecision({ cooldownUntil }, 10_000)).toEqual({
			allowed: true,
		});
	});
});
