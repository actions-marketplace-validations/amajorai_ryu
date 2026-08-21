import { createAccessControl } from "better-auth/plugins/access";
import {
	defaultAc,
	defaultRoles,
} from "better-auth/plugins/organization/access";

// This access-control vocabulary governs Better Auth organization-management
// records only. `apiKey` actions authorize creating/listing/revoking an org key
// record; they do not grant any Ryu capability scope. Ryu's server-side
// permission model remains the authority for `resource:action` scopes carried
// by the resulting key.
export const ryuOrganizationAccessControl = createAccessControl({
	...defaultAc.statements,
	apiKey: ["create", "read", "update", "delete"],
});

export const ryuOrganizationRoles = {
	admin: ryuOrganizationAccessControl.newRole({
		...defaultRoles.admin.statements,
		apiKey: ["create", "read", "update", "delete"],
	}),
	owner: ryuOrganizationAccessControl.newRole({
		...defaultRoles.owner.statements,
		apiKey: ["create", "read", "update", "delete"],
	}),
	member: ryuOrganizationAccessControl.newRole({
		...defaultRoles.member.statements,
		apiKey: ["read"],
	}),
	viewer: ryuOrganizationAccessControl.newRole({
		...defaultRoles.member.statements,
		apiKey: ["read"],
	}),
};
