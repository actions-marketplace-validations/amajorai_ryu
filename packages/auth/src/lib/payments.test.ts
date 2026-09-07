import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let customers: {
	id: string;
	externalId: string | null;
	metadata: Record<string, string>;
}[] = [];
const create = mock(async () => ({}));
const update = mock(async () => ({}));
mock.module("@ryu/env/server", () => ({ env: {} }));
mock.module("@polar-sh/sdk", () => ({
	Polar: class {
		customers = {
			list: async () => ({ result: { items: customers } }),
			create,
			update,
		};
	},
}));
const { ensurePolarCustomer } = await import("./payments.ts");
beforeEach(() => {
	customers = [];
	create.mockClear();
	update.mockClear();
});
afterAll(() => mock.restore());

describe("personal customer provisioning", () => {
	it("creates a customer when the email has no existing payer", async () => {
		expect(
			await ensurePolarCustomer({ id: "user-B", email: "person@example.com" })
		).toBe(true);
		expect(create).toHaveBeenCalledWith({
			email: "person@example.com",
			externalId: "user-B",
			name: undefined,
		});
	});
	it("recognizes an already verified personal identity", async () => {
		customers = [{ id: "payer-B", externalId: "user-B", metadata: {} }];
		expect(
			await ensurePolarCustomer({ id: "user-B", email: "person@example.com" })
		).toBe(true);
		expect(create).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
	const otherCustomers: typeof customers = [
		{ id: "payer-A", externalId: "ryu:organization:A", metadata: {} },
		{ id: "legacy-org", externalId: null, metadata: { scope: "org" } },
		{ id: "legacy-personal", externalId: null, metadata: {} },
		{ id: "other-personal", externalId: "user-A", metadata: {} },
	];
	for (const customer of otherCustomers) {
		it(`does not claim ${customer.id} merely because its email matches`, async () => {
			customers = [customer];
			expect(
				await ensurePolarCustomer({ id: "user-B", email: "person@example.com" })
			).toBe(false);
			expect(create).not.toHaveBeenCalled();
			expect(update).not.toHaveBeenCalled();
		});
	}
});
