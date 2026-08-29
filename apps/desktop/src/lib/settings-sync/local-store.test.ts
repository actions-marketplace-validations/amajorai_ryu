// The observer is what makes sync notice anything at all, so these cover the
// two ways it can be silently wrong: missing a write (nothing ever syncs) and
// reporting a write it made itself (an applied remote value bounces straight
// back up, and two machines ping-pong forever).

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register happy-dom FIRST, on the same guard every other DOM test in this
// package uses. Without it this file's `window` stub was the only `window` in
// the process when it ran first, and its teardown then DELETED the global —
// leaving every later file that calls `window.dispatchEvent` with nothing.
// Registering means the stubs below replace real globals and the teardown puts
// real globals back, which is the invariant the whole package depends on.
if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

/**
 * `bun test` runs this package, and its vitest shim has no `vi.stubGlobal` — the
 * import threw before a single case ran. Installed directly on `globalThis`
 * instead; there is nothing to restore afterwards because both globals are
 * absent under bun and this file owns them for its whole lifetime, which is the
 * install-once contract the comment below depends on.
 */
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

const stubGlobal = (name: string, value: unknown): void => {
	if (!originalGlobals.has(name)) {
		originalGlobals.set(
			name,
			Object.getOwnPropertyDescriptor(globalThis, name)
		);
	}
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
};

import {
	applyRemote,
	installSettingsObserver,
	localTimestamp,
	markLocalChange,
	onSettingsChange,
	readLocal,
} from "./local-store.ts";

/**
 * A minimal in-memory localStorage, installed ONCE — before the observer patches
 * it — and cleared between tests. Re-stubbing per test would leave the observer's
 * captured original setter pointing at a discarded store, which is a test
 * artifact, not a bug in the module: the app installs the observer exactly once
 * over one real Storage.
 */
const store = new Map<string, string>();

// INSIDE `beforeAll`, not at module scope. `bun test` imports EVERY file in the
// package before it runs a single test, so a module-level stub is applied at
// import time and owns the global for the whole run — an `afterAll` here cannot
// undo it in time, because other files' tests have already executed against it.
// A `window` carrying only `addEventListener` reached every later file that way,
// and each one died on `window.dispatchEvent`. Installed and torn down around
// THIS file's tests instead, which is the only scope that is actually ours.
beforeAll(() => {
	stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	});
	// `window` for the `storage` listener the observer registers.
	stubGlobal("window", {
		addEventListener: mock(() => {
			/* the observer only needs the listener to exist */
		}),
	});
	installSettingsObserver();
});

beforeEach(() => {
	store.clear();
});

const SYNCED_KEY = "ryu_pointer_cursor";
const UNSYNCED_KEY = "ryu_session_token";

describe("change observation", () => {
	it("reports a write to an allowlisted key", () => {
		const seen: string[] = [];
		const off = onSettingsChange((key) => seen.push(key));
		localStorage.setItem(SYNCED_KEY, "true");
		off();
		expect(seen).toContain(SYNCED_KEY);
	});

	it("ignores a write to anything not on the allowlist", () => {
		const seen: string[] = [];
		const off = onSettingsChange((key) => seen.push(key));
		localStorage.setItem(UNSYNCED_KEY, "secret");
		off();
		expect(seen).toEqual([]);
	});

	it("still performs the write it observes", () => {
		localStorage.setItem(SYNCED_KEY, "false");
		expect(readLocal(SYNCED_KEY)).toBe("false");
	});

	it("reports a removal", () => {
		localStorage.setItem(SYNCED_KEY, "true");
		const seen: string[] = [];
		const off = onSettingsChange((key) => seen.push(key));
		localStorage.removeItem(SYNCED_KEY);
		off();
		expect(seen).toContain(SYNCED_KEY);
	});
});

describe("applying a remote value", () => {
	it("does not report as a local change", () => {
		const seen: string[] = [];
		const off = onSettingsChange((key) => seen.push(key));
		applyRemote(SYNCED_KEY, "true", 1234);
		off();
		expect(seen).toEqual([]);
		expect(readLocal(SYNCED_KEY)).toBe("true");
	});

	it("adopts the remote timestamp rather than stamping now", () => {
		applyRemote(SYNCED_KEY, "true", 4242);
		expect(localTimestamp(SYNCED_KEY)).toBe(4242);
	});

	it("deletes when the remote value is a tombstone", () => {
		localStorage.setItem(SYNCED_KEY, "true");
		applyRemote(SYNCED_KEY, null, 99);
		expect(readLocal(SYNCED_KEY)).toBeNull();
	});
});

describe("timestamps", () => {
	it("reads 0 for a key that never changed", () => {
		expect(localTimestamp("ryu_radius")).toBe(0);
	});

	it("records an explicit change time", () => {
		markLocalChange("ryu_radius", 777);
		expect(localTimestamp("ryu_radius")).toBe(777);
	});

	it("stamps a real write with a current time", () => {
		const before = Date.now();
		localStorage.setItem(SYNCED_KEY, "true");
		expect(localTimestamp(SYNCED_KEY)).toBeGreaterThanOrEqual(before);
	});
});

// PUT THE GLOBALS BACK when this file is done. `bun test` runs the whole package
// in ONE process, and the `window` installed above is a two-property stand-in —
// it has `addEventListener` and nothing else. Left in place it becomes the
// `window` every later file sees, so the first one to call `window.dispatchEvent`
// dies on a global this file owns. That failure only ever appears in the full
// run, never when the victim is run alone, which is what makes it expensive to
// track down.
afterAll(() => {
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) {
			Object.defineProperty(globalThis, name, descriptor);
		} else {
			delete (globalThis as Record<string, unknown>)[name];
		}
	}
	originalGlobals.clear();
});
