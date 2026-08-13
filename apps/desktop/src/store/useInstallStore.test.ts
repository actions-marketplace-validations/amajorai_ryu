// apps/desktop/src/store/useInstallStore.test.ts
//
// The shared "is this store item busy?" flag. The refcount is the load-bearing
// part: the Store overlaps calls on ONE id all the time (an add immediately
// followed by an enable), and a plain boolean would let the first call's
// completion clear the second call's flag — which is exactly the class of bug
// this store was introduced to end.

import { beforeEach, describe, expect, test } from "bun:test";
import {
	beginInstall,
	endInstall,
	useInstallStore,
} from "./useInstallStore.ts";

const busy = (id: string) => (useInstallStore.getState().inFlight[id] ?? 0) > 0;

describe("useInstallStore", () => {
	beforeEach(() => {
		useInstallStore.getState().reset();
	});

	test("begin marks an id busy; end releases it", () => {
		expect(busy("@ryu/crm")).toBe(false);
		beginInstall("@ryu/crm");
		expect(busy("@ryu/crm")).toBe(true);
		endInstall("@ryu/crm");
		expect(busy("@ryu/crm")).toBe(false);
	});

	test("ids are independent", () => {
		beginInstall("a");
		expect(busy("a")).toBe(true);
		expect(busy("b")).toBe(false);
	});

	test("overlapping calls on one id: the first end does NOT clear the second", () => {
		beginInstall("a");
		beginInstall("a");
		endInstall("a");
		expect(busy("a")).toBe(true);
		endInstall("a");
		expect(busy("a")).toBe(false);
	});

	test("a released id is deleted, not left as a zero — nothing accumulates", () => {
		beginInstall("a");
		endInstall("a");
		expect(useInstallStore.getState().inFlight).toEqual({});
	});

	test("end on an id that was never begun is a no-op, not a negative count", () => {
		endInstall("ghost");
		expect(useInstallStore.getState().inFlight).toEqual({});
		expect(busy("ghost")).toBe(false);
	});

	test("reset clears everything — node switches must not leave ids spinning", () => {
		beginInstall("a");
		beginInstall("b");
		useInstallStore.getState().reset();
		expect(useInstallStore.getState().inFlight).toEqual({});
	});
});
