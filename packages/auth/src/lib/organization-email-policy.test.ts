import { describe, expect, it } from "bun:test";
import {
	businessEmailDecision,
	businessEmailDomainDecision,
	businessEmailMessage,
} from "./organization-email-policy.ts";

describe("Teams business-email policy", () => {
	it("rejects public mailbox domains for invitations", () => {
		const decision = businessEmailDomainDecision("person@gmail.com");
		expect(decision).toEqual({
			allowed: false,
			domain: "gmail.com",
			reason: "consumer_email",
		});
		expect(businessEmailMessage(decision, "invitation")).toContain("Gmail");
	});

	it("allows a verified custom company domain", () => {
		expect(
			businessEmailDecision({
				email: "OWNER@Acme.example",
				emailVerified: true,
			})
		).toEqual({ allowed: true, domain: "acme.example" });
	});

	it("requires Better Auth email verification", () => {
		const decision = businessEmailDecision({
			email: "owner@acme.example",
			emailVerified: false,
		});
		expect(decision.reason).toBe("email_unverified");
	});

	it("supports an exact domain allowlist for high-assurance deployments", () => {
		expect(
			businessEmailDecision(
				{ email: "owner@acme.example", emailVerified: true },
				{
					read: (key) =>
						key === "RYU_TEAMS_ALLOWED_EMAIL_DOMAINS"
							? "acme.example"
							: undefined,
				}
			)
		).toEqual({ allowed: true, domain: "acme.example" });
		expect(
			businessEmailDecision(
				{ email: "owner@other.example", emailVerified: true },
				{
					read: (key) =>
						key === "RYU_TEAMS_ALLOWED_EMAIL_DOMAINS"
							? "acme.example"
							: undefined,
				}
			).reason
		).toBe("domain_not_allowed");
	});
});
