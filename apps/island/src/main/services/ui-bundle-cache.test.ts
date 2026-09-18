import { expect, mock, test } from "bun:test";

let calls = 0;
mock.module("./plugin-host.ts", () => ({
	pluginUiBundle: async (pluginId: string) => {
		calls += 1;
		return pluginId === "missing"
			? { available: true, code: null }
			: { available: true, code: `bundle:${pluginId}` };
	},
}));

const { readUiBundle } = await import("./ui-bundle-reads.ts");

function owner(id: number) {
	return {
		id,
		once: () => undefined,
		removeListener: () => undefined,
	};
}

test("settled bundle bodies are reused by the Island IPC reader", async () => {
	const target = owner(1);
	const first = await readUiBundle(target, "cached", "first");
	const second = await readUiBundle(target, "cached", "second");

	expect(first).toEqual({ available: true, code: "bundle:cached" });
	expect(second).toEqual(first);
	expect(calls).toBe(1);
});

test("missing Island bundles are retried after an app is enabled", async () => {
	const target = owner(2);
	const first = await readUiBundle(target, "missing", "first");
	const second = await readUiBundle(target, "missing", "second");

	expect(first).toEqual({ available: true, code: null });
	expect(second).toEqual(first);
	expect(calls).toBe(3);
});
