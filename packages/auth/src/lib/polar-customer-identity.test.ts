import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let externalCustomer: { id: string; externalId: string } | null = null;
let externalFailure: unknown = null;
let knownContract: { polarCustomerId: string } | null = null;
const createdCustomer = {
	id: "created-org",
	externalId: "ryu:organization:B",
	metadata: { scope: "org", orgId: "B" },
};
const createCustomer = mock(async (input: { externalId?: string | null }) =>
	input.externalId?.startsWith("ryu:organization:")
		? createdCustomer
		: { id: "created-personal", externalId: input.externalId, metadata: {} }
);
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
		customers: {
			create: createCustomer,
			getExternal: externalLookup,
			list: emailLookup,
		},
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
const {
	ensurePersonalPolarCustomer,
	resolveOrganizationPolarCustomerId,
	resolvePersonalPolarCustomerId,
} = await import("./polar-customer-identity.ts");

beforeEach(() => {
	externalCustomer = null;
	externalFailure = null;
	knownContract = null;
	personalCustomers = [];
	externalLookup.mockClear();
	emailLookup.mockClear();
	createCustomer.mockClear();
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
	it("creates a team customer when the organization identity is new", async () => {
		const { ensureOrganizationPolarCustomer } = await import(
			"./polar-customer-identity.ts"
		);
		expect(
			await ensureOrganizationPolarCustomer({
				email: "owner@example.com",
				organizationId: "B",
				ownerUserId: "user-B",
			})
		).toBe("created-org");
		expect(createCustomer).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "owner@example.com",
				externalId: "ryu:organization:B",
				type: "team",
			})
		);
	});
	it("turns a provider email collision into an explicit reconciliation error", async () => {
		createCustomer.mockRejectedValueOnce(
			Object.assign(new Error("email already exists"), { statusCode: 422 })
		);
		const { ensureOrganizationPolarCustomer } = await import(
			"./polar-customer-identity.ts"
		);
		await expect(
			ensureOrganizationPolarCustomer({
				email: "owner@example.com",
				organizationId: "B",
			})
		).rejects.toMatchObject({
			code: "polar_customer_identity_reconciliation_required",
		});
	});
	it("creates an individual customer when a personal checkout is new", async () => {
		expect(
			await ensurePersonalPolarCustomer({
				email: "owner@example.com",
				userId: "user-B",
			})
		).toBe("created-personal");
		expect(createCustomer).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "owner@example.com",
				externalId: "user-B",
				type: "individual",
			})
		);
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
