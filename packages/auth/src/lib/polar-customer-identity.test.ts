import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let externalCustomer: { id: string; externalId: string } | null = null;
let externalFailure: unknown = null;
let knownContract: { polarCustomerId: string } | null = null;
let personalCustomers: {
	id: string;
	externalId: string | null;
	metadata: Record<string, string>;
}[] = [];
const externalLookup = mock(async (_input: { externalId: string }) => {
	if (externalFailure) {
		throw externalFailure;
	}
	if (!externalCustomer) {
		throw Object.assign(new Error("customer missing"), { statusCode: 404 });
	}
	return { ...externalCustomer, metadata: {} };
});
const emailLookup = mock(() =>
	Promise.resolve({
		async *[Symbol.asyncIterator]() {
			yield { result: { items: personalCustomers } };
		},
	})
);
mock.module("./payments.ts", () => ({
	polarClient: {
		customers: { getExternal: externalLookup, list: emailLookup },
	},
}));
mock.module("@ryu/db/models/organization-seat-entitlement.model", () => ({
	OrganizationSeatEntitlement: {
		findOne: () => ({ select: () => ({ lean: async () => knownContract }) }),
	},
}));
mock.module("@ryu/db/models/polar-billing-projection.model", () => ({
	PolarBillingProjection: {
		findOne: () => ({ select: () => ({ lean: async () => null }) }),
	},
}));
const { resolveOrganizationPolarCustomerId, resolvePersonalPolarCustomerId } =
	await import("./polar-customer-identity.ts");

beforeEach(() => {
	externalCustomer = null;
	externalFailure = null;
	knownContract = null;
	personalCustomers = [];
	externalLookup.mockClear();
	emailLookup.mockClear();
});
afterAll(() => mock.restore());

describe("Polar customer ownership", () => {
	it("does not adopt A's customer by shared payer email when B is missing", async () => {
		personalCustomers = [
			{ id: "customer-A", externalId: "ryu:organization:A", metadata: {} },
		];
		expect(await resolveOrganizationPolarCustomerId("B")).toBeNull();
		expect(externalLookup).toHaveBeenCalledWith({
			externalId: "ryu:organization:B",
		});
		expect(emailLookup).not.toHaveBeenCalled();
	});
	it("accepts an exact organization identity", async () => {
		externalCustomer = { id: "customer-B", externalId: "ryu:organization:B" };
		expect(await resolveOrganizationPolarCustomerId("B")).toBe("customer-B");
	});
	it("rejects mismatched provider identity", async () => {
		externalCustomer = { id: "customer-A", externalId: "ryu:organization:A" };
		await expect(resolveOrganizationPolarCustomerId("B")).rejects.toThrow(
			"different billing identity"
		);
	});
	it("blocks duplicate checkout for a known unverified legacy binding", async () => {
		knownContract = { polarCustomerId: "legacy-payer" };
		await expect(resolveOrganizationPolarCustomerId("B")).rejects.toThrow(
			"reconciliation"
		);
		expect(emailLookup).not.toHaveBeenCalled();
	});
	it("propagates provider outages without an email fallback", async () => {
		externalFailure = new Error("provider unavailable");
		await expect(resolveOrganizationPolarCustomerId("B")).rejects.toThrow(
			"provider unavailable"
		);
		expect(emailLookup).not.toHaveBeenCalled();
	});
	it("uses exact personal identity without querying shared payer email", async () => {
		externalCustomer = { id: "personal", externalId: "user-1" };
		expect(await resolvePersonalPolarCustomerId("user-1")).toBe("personal");
		expect(externalLookup).toHaveBeenCalledWith({ externalId: "user-1" });
		expect(emailLookup).not.toHaveBeenCalled();
	});
	it("returns no personal account when only a shared email matches", async () => {
		personalCustomers = [
			{ id: "customer-A", externalId: "ryu:organization:A", metadata: {} },
		];
		expect(await resolvePersonalPolarCustomerId("user-1")).toBeNull();
		expect(emailLookup).not.toHaveBeenCalled();
	});
	for (const externalId of ["ryu:organization:A", "user-2"]) {
		it(`rejects ${externalId} for a personal user identity`, async () => {
			externalCustomer = { id: "other-payer", externalId };
			await expect(resolvePersonalPolarCustomerId("user-1")).rejects.toThrow(
				"different billing identity"
			);
		});
	}
});
