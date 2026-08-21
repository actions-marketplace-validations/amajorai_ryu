// apps/desktop/src/lib/tauri-ready.test.ts
//
// The gate's whole reason to exist is the ORDERING case: a call issued before
// Tauri injected `window.__TAURI_INTERNALS__` must queue and resolve once the
// bridge arrives, rather than rejecting with the TypeError that production
// recorded 88 times. A vite build cannot prove that; only this can.
//
// `window` does not exist under `bun test`, so each case installs a fake one and
// drives `__TAURI_INTERNALS__` by hand — which is exactly the object the real
// `@tauri-apps/api` reaches into (`invoke()` is
// `window.__TAURI_INTERNALS__.invoke(...)`), so the module under test is
// exercised against the REAL Tauri client, not a stand-in for it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	invokeWhenReady,
	isTauriReady,
	listenWhenReady,
	resetTauriGateForTests,
	TauriUnavailableError,
	withTauri,
} from "./tauri-ready.ts";

interface FakeInternals {
	invoke: (cmd: string, args?: unknown) => Promise<unknown>;
	transformCallback: (cb: unknown, once?: boolean) => number;
	unregisterCallback?: (id: number) => void;
}

const globalWithWindow = globalThis as Omit<typeof globalThis, "window"> & {
	window?: { __TAURI_INTERNALS__?: FakeInternals };
};

/** A stand-in for what Tauri injects. `invoke` records the calls it saw so a test
 *  can assert the bounded retry fired exactly once. */
function makeInternals(
	respond: (cmd: string, args?: unknown) => Promise<unknown>
): { internals: FakeInternals; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		internals: {
			invoke: (cmd, args) => {
				calls.push(cmd);
				return respond(cmd, args);
			},
			// The event API funnels its handler through this before invoking
			// `plugin:event|listen`; a number id is all it needs back.
			transformCallback: () => 1,
			unregisterCallback: () => undefined,
		},
	};
}

beforeEach(() => {
	resetTauriGateForTests();
	globalWithWindow.window = {};
});

afterEach(() => {
	resetTauriGateForTests();
	globalWithWindow.window = undefined;
});

describe("isTauriReady", () => {
	test("is false until the bridge is injected, true after", () => {
		expect(isTauriReady()).toBe(false);
		const { internals } = makeInternals(() => Promise.resolve(null));
		// biome-ignore lint/style/noNonNullAssertion: installed in beforeEach
		globalWithWindow.window!.__TAURI_INTERNALS__ = internals;
		expect(isTauriReady()).toBe(true);
	});
});

describe("invokeWhenReady", () => {
	test("passes straight through when the bridge is already there", async () => {
		const { internals, calls } = makeInternals(() => Promise.resolve("ok"));
		// biome-ignore lint/style/noNonNullAssertion: installed in beforeEach
		globalWithWindow.window!.__TAURI_INTERNALS__ = internals;

		await expect(invokeWhenReady<string>("get_ryu_status")).resolves.toBe("ok");
		expect(calls).toEqual(["get_ryu_status"]);
	});

	test("QUEUES a call made before the bridge exists and resolves once it lands", async () => {
		const { internals, calls } = makeInternals(() =>
			Promise.resolve({ nodes: [], default: "local" })
		);

		// Issued with no bridge at all — this is the boot race the gate exists for.
		const pending = invokeWhenReady<{
			default: string;
			nodes: unknown[];
		}>("list_nodes");

		// Tauri injects a beat later, exactly as a slow cold start does.
		setTimeout(() => {
			// biome-ignore lint/style/noNonNullAssertion: installed in beforeEach
			globalWithWindow.window!.__TAURI_INTERNALS__ = internals;
		}, 60);

		await expect(pending).resolves.toEqual({ nodes: [], default: "local" });
		// One bounded retry: the pre-bridge attempt never reached `internals`.
		expect(calls).toEqual(["list_nodes"]);
	});

	test("rejects with a typed error, not a TypeError, when the bridge never arrives", async () => {
		let caught: unknown;
		try {
			await invokeWhenReady("list_nodes");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(TauriUnavailableError);
		expect((caught as TauriUnavailableError).target).toBe("list_nodes");
	});

	test("does NOT retry or swallow a genuine failure once the bridge is present", async () => {
		const { internals, calls } = makeInternals((cmd) =>
			Promise.reject(new Error(`command ${cmd} blew up`))
		);
		// biome-ignore lint/style/noNonNullAssertion: installed in beforeEach
		globalWithWindow.window!.__TAURI_INTERNALS__ = internals;

		await expect(invokeWhenReady("add_node")).rejects.toThrow(
			"command add_node blew up"
		);
		expect(calls).toEqual(["add_node"]);
	});
});

describe("listenWhenReady", () => {
	test("degrades to a no-op unlisten outside Tauri instead of rejecting", async () => {
		const unlisten = await listenWhenReady("nodes-changed", () => undefined);
		expect(typeof unlisten).toBe("function");
		// Calling it must be safe — App.tsx tears these down on unmount.
		expect(() => unlisten()).not.toThrow();
	});

	test("subscribes once the bridge arrives late", async () => {
		const { internals, calls } = makeInternals(() => Promise.resolve(7));

		const pending = listenWhenReady("core-install-progress", () => undefined);
		setTimeout(() => {
			// biome-ignore lint/style/noNonNullAssertion: installed in beforeEach
			globalWithWindow.window!.__TAURI_INTERNALS__ = internals;
		}, 60);

		const unlisten = await pending;
		expect(typeof unlisten).toBe("function");
		expect(calls).toEqual(["plugin:event|listen"]);
	});
});

describe("withTauri", () => {
	test("resolves null outside Tauri rather than throwing the raw TypeError", async () => {
		const result = await withTauri(() => {
			// What `getCurrentWebviewWindow()` does outside Tauri.
			if (!globalWithWindow.window?.__TAURI_INTERNALS__) {
				throw new TypeError("window.__TAURI_INTERNALS__ is unavailable");
			}
			return "unreachable";
		});
		expect(result).toBeNull();
	});

	test("propagates a real error untouched", async () => {
		await expect(
			withTauri(() => {
				throw new Error("not a bridge problem");
			})
		).rejects.toThrow("not a bridge problem");
	});
});
