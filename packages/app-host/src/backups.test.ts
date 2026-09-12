import { expect, test } from "bun:test";
import { type Capability, dispatchRpc, type HostServices } from "./rpc.ts";

test("backup methods reject a frame without the backup capability", async () => {
	let invoked = false;
	const services: HostServices = {
		listAgents: async () => [],
		registerRoute: async () => ({}),
		backupsRequest: async () => {
			invoked = true;
			return {};
		},
	};
	for (const method of [
		"backups.destinations",
		"backups.create",
		"backups.list",
		"backups.get",
		"backups.restore",
	]) {
		await expect(
			dispatchRpc(method, [{}], new Set<Capability>(), services)
		).rejects.toThrow();
	}
	expect(invoked).toBe(false);
});

test("granted frame forwards snapshot arguments through the existing host bridge", async () => {
	const calls: unknown[] = [];
	const services: HostServices = {
		listAgents: async () => [],
		registerRoute: async () => ({}),
		backupsRequest: async (method: string, input: unknown) => {
			calls.push({ method, input });
			return { id: "backup" };
		},
	};
	const input = {
		destinationId: "dest",
		namespace: "records",
		idempotencyKey: "save-1",
		data: { records: [] },
	};
	expect(
		await dispatchRpc(
			"backups.create",
			[input],
			new Set<Capability>(["backups.app"]),
			services
		)
	).toEqual({ id: "backup" });
	expect(calls).toEqual([{ method: "backups.create", input }]);
});
