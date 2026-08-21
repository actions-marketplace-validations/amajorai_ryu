import { describe, expect, it } from "bun:test";
import {
	ryuOrganizationAccessControl,
	ryuOrganizationRoles,
} from "./organization-access.ts";

describe("Ryu Better Auth organization access", () => {
	it("keeps API-key management separate from Ryu capability scopes", () => {
		expect(ryuOrganizationAccessControl.statements).not.toHaveProperty("chat");
		expect(ryuOrganizationAccessControl.statements).toMatchObject({
			apiKey: ["create", "read", "update", "delete"],
		});
	});

	it("gives members read access while admins and owners manage key records", () => {
		expect(ryuOrganizationRoles.member.statements.apiKey).toEqual(["read"]);
		expect(ryuOrganizationRoles.admin.statements.apiKey).toEqual([
			"create",
			"read",
			"update",
			"delete",
		]);
		expect(ryuOrganizationRoles.owner.statements.apiKey).toEqual([
			"create",
			"read",
			"update",
			"delete",
		]);
		expect(ryuOrganizationRoles.viewer.statements.apiKey).toEqual(["read"]);
	});
});
