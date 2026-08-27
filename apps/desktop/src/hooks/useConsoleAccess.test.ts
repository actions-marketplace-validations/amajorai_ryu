import { describe, expect, test } from "bun:test";
import type { OrgListEntry } from "@/src/lib/api/orgs.ts";
import { canAccessConsoleForNode } from "./useConsoleAccess.ts";

function organization(id: string, role: string | null): OrgListEntry {
	return {
		createdAt: null,
		id,
		isPersonal: false,
		logo: null,
		name: "Acme",
		role,
		slug: "acme",
	};
}

describe("Console product access", () => {
	test("does not require a Ryu organization for self-hosted nodes", () => {
		expect(
			canAccessConsoleForNode({
				managed: false,
				orgId: null,
				organizations: undefined,
				settled: false,
			})
		).toBe(true);
	});

	test("requires a settled matching managed-node organization", () => {
		const organizations = [organization("org-cloud", "member")];
		expect(
			canAccessConsoleForNode({
				managed: true,
				orgId: "org-cloud",
				organizations,
				settled: true,
			})
		).toBe(false);
		expect(
			canAccessConsoleForNode({
				managed: true,
				orgId: "org-other",
				organizations: [organization("org-other", "owner")],
				settled: false,
			})
		).toBe(false);
	});

	test("allows only owners and admins for the managed node org", () => {
		for (const role of ["owner", "admin"]) {
			expect(
				canAccessConsoleForNode({
					managed: true,
					orgId: "org-cloud",
					organizations: [organization("org-cloud", role)],
					settled: true,
				})
			).toBe(true);
		}
	});
});
