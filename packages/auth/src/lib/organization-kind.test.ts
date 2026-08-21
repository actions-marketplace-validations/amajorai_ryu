import { describe, expect, it } from "bun:test";
import {
	metadataWithOrganizationKind,
	organizationKindFromMetadata,
	PERSONAL_ORGANIZATION_KIND,
	parseOrganizationMetadata,
	TEAMS_ORGANIZATION_KIND,
} from "./organization-kind.ts";

describe("organization kind metadata", () => {
	it("round-trips Better Auth's serialized metadata", () => {
		const metadata = metadataWithOrganizationKind(
			JSON.stringify({ source: "signup" }),
			PERSONAL_ORGANIZATION_KIND
		);
		expect(metadata).toEqual({
			source: "signup",
			organizationKind: "personal",
		});
		expect(organizationKindFromMetadata(JSON.stringify(metadata))).toBe(
			PERSONAL_ORGANIZATION_KIND
		);
	});

	it("distinguishes a paid in-place conversion from a personal org", () => {
		const metadata = metadataWithOrganizationKind({}, TEAMS_ORGANIZATION_KIND, {
			upgradedFromPersonalAt: "2026-08-21T00:00:00.000Z",
		});
		expect(organizationKindFromMetadata(metadata)).toBe(
			TEAMS_ORGANIZATION_KIND
		);
		expect(parseOrganizationMetadata(metadata).upgradedFromPersonalAt).toBe(
			"2026-08-21T00:00:00.000Z"
		);
	});
});
