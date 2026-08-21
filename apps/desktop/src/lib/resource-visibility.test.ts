import { describe, expect, it } from "bun:test";
import {
	isOrganizationAdminRole,
	isSharedResource,
	parseVisibilityDragPayload,
	resourceVisibilityDndMime,
	resourceVisibilityForGroup,
	resourceVisibilityGroup,
	resourceVisibilityLabel,
	serializeVisibilityDragPayload,
	toResourceVisibility,
} from "./resource-visibility.ts";

describe("resource visibility vocabulary", () => {
	it("treats private as the safe fallback for older payloads", () => {
		expect(toResourceVisibility(undefined)).toBe("private");
		expect(toResourceVisibility("unknown")).toBe("private");
		expect(resourceVisibilityGroup(undefined)).toBe("private");
		expect(resourceVisibilityLabel(undefined)).toBe("Private");
	});

	it("groups organization and named-team scopes under Team", () => {
		expect(resourceVisibilityGroup("org")).toBe("team");
		expect(resourceVisibilityGroup("team")).toBe("team");
		expect(resourceVisibilityLabel("org")).toBe("Team");
		expect(isSharedResource("team")).toBe(true);
	});

	it("keeps system spaces visible as shared node resources", () => {
		expect(resourceVisibilityGroup("private", true)).toBe("team");
		expect(resourceVisibilityLabel("private", true)).toBe("Team");
		expect(isSharedResource("private", true)).toBe(true);
	});

	it("maps the product groups to the public Core scopes", () => {
		expect(resourceVisibilityForGroup("private")).toBe("private");
		expect(resourceVisibilityForGroup("team")).toBe("org");
	});

	it("recognizes only organization admins and owners", () => {
		expect(isOrganizationAdminRole("admin")).toBe(true);
		expect(isOrganizationAdminRole("owner")).toBe(true);
		expect(isOrganizationAdminRole("member")).toBe(false);
		expect(isOrganizationAdminRole(null)).toBe(false);
	});

	it("validates visibility drag payloads at the DataTransfer boundary", () => {
		const encoded = serializeVisibilityDragPayload({
			from: "private",
			id: "space-1",
			name: "Launch notes",
			resourceType: "space",
		});
		expect(parseVisibilityDragPayload(encoded)).toEqual({
			from: "private",
			id: "space-1",
			name: "Launch notes",
			resourceType: "space",
		});
		expect(parseVisibilityDragPayload("not-json")).toBeNull();
		expect(resourceVisibilityDndMime("chat")).toBe(
			"application/x-ryu-resource-visibility-chat"
		);
		expect(
			parseVisibilityDragPayload(
				JSON.stringify({ from: "private", id: "space-1" })
			)
		).toBeNull();
	});
});
