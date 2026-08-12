// The observer is what makes sync notice anything at all, so these cover the
// two ways it can be silently wrong: missing a write (nothing ever syncs) and
// reporting a write it made itself (an applied remote value bounces straight
// back up, and two machines ping-pong forever).

import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.stubGlobal("localStorage", {
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
vi.stubGlobal("window", { addEventListener: vi.fn() });

installSettingsObserver();

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
