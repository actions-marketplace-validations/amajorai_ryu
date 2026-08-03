// apps/desktop/src/lib/gating/planCapBridge.test.ts
//
// Tests for the numeric-cap (Bucket-3) enforcement primitives the desktop
// entity-creation stores read through. The security-shaped invariants here are:
//   - OFF the managed path (no billing auth) every limit is Infinity — a
//     self-hoster who never signs in stays completely uncapped.
//   - Before the React layer first syncs the plan, caps FAIL OPEN (Infinity) so
//     a payer is never falsely blocked before the entitlement resolves.
//   - `enforcePlanCap` opens the upgrade modal AND throws so the cap holds even
//     when the modal requester has not been registered.
//
// Mocking:
//   - `@/src/lib/api/billing.ts` is stubbed to a toggleable `hasBillingAuth`
//     (a `let` the tests flip) so the managed-path branch is driven directly,
//     without the real billing client's `@/lib/auth-client.ts` → `@ryu/ui`
//     resolution chain. No test imports billing, so this module-wide mock has no
//     other victim.
//   - `useNodeStore.test.ts` registers a process-wide `mock.module` stub for
//     `@/src/lib/gating/planCapBridge.ts` (it needs only a no-op `enforcePlanCap`).
//     That mock leaks across files and would shadow the REAL module here. A
//     distinct `?real` query forces bun to key this as a separate module and load
//     the genuine implementation (its own singleton — exactly the isolation this
//     test wants).
//
// The singleton `state.plan` starts `undefined` and can never be reset to
// `undefined` again (no reset export), so the "unsynced → fail-open" case MUST be
// asserted before any `syncPlanCapState`.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QUOTAS } from "@ryu/auth/lib/plans";

let billingAuthOn = false;

mock.module("@/src/lib/api/billing.ts", () => ({
	hasBillingAuth: () => billingAuthOn,
}));

const {
	effectivePlan,
	enforcePlanCap,
	PlanCapError,
	resolveCapLimit,
	syncPlanCapState,
} = await import("./planCapBridge.ts?real");

beforeEach(() => {
	billingAuthOn = false;
});

// ---------------------------------------------------------------------------
// This block MUST run first: the singleton `state.plan` is `undefined` only
// until the first `syncPlanCapState`, and nothing can restore it. Once any
// later block syncs, this branch is unreachable.
// ---------------------------------------------------------------------------
describe("resolveCapLimit — fail-open before the plan is synced", () => {
	test("unsynced + billing auth on → Infinity (payer never falsely blocked)", () => {
		billingAuthOn = true;
		expect(resolveCapLimit("maxAgents")).toBe(Number.POSITIVE_INFINITY);
	});

	test("off the managed path is Infinity regardless of sync state", () => {
		billingAuthOn = false;
		expect(resolveCapLimit("maxSpaces")).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("effectivePlan", () => {
	test("null verdict → null (unknown plan)", () => {
		expect(effectivePlan(null)).toBeNull();
	});

	test("a purchased plan is returned verbatim", () => {
		expect(effectivePlan({ plan: "max", proUnlocked: true } as never)).toBe(
			"max"
		);
	});

	test("trial / lifetime (proUnlocked, no purchased plan) bands into 'pro'", () => {
		expect(effectivePlan({ plan: null, proUnlocked: true } as never)).toBe(
			"pro"
		);
	});

	test("signed-in free (not proUnlocked, no plan) stays on the free (null) caps", () => {
		expect(
			effectivePlan({ plan: null, proUnlocked: false } as never)
		).toBeNull();
	});
});

describe("resolveCapLimit — after sync", () => {
	test("off the managed path is Infinity even with a free plan synced", () => {
		syncPlanCapState(null, () => undefined);
		billingAuthOn = false;
		// A finite free cap would apply on the managed path, but not off it.
		expect(resolveCapLimit("maxAgents")).toBe(Number.POSITIVE_INFINITY);
	});

	test("managed path + free plan reads the finite FREE_TIER_LIMITS value", () => {
		syncPlanCapState(null, () => undefined);
		billingAuthOn = true;
		// FREE_TIER_LIMITS.maxAgents === 10 (single source of truth in plans.ts).
		expect(resolveCapLimit("maxAgents")).toBe(10);
	});

	test("a paid plan lifts the cap (Infinity) on the managed path", () => {
		syncPlanCapState("pro", () => undefined);
		billingAuthOn = true;
		expect(resolveCapLimit("maxAgents")).toBe(Number.POSITIVE_INFINITY);
	});
});

// ---------------------------------------------------------------------------
// App-declared quotas. `maxMonitors` is declared by `@ryu/monitors`, so it is a
// limit only on a node that actually has Monitors — the same "the row appears
// and disappears with the app" rule the Danger Zone categories follow. Kernel
// keys (`maxAgents`) have no app to uninstall and must be unaffected by all of
// this, which is what makes these two assertions a pair.
// ---------------------------------------------------------------------------
describe("resolveCapLimit — app-declared quotas follow their app", () => {
	test("an app-owned key is uncapped when its app is not enabled", () => {
		syncPlanCapState(null, () => undefined, new Set(["@ryu/mail"]));
		billingAuthOn = true;
		expect(resolveCapLimit("maxMonitors")).toBe(Number.POSITIVE_INFINITY);
		// The kernel key alongside it still binds.
		expect(resolveCapLimit("maxAgents")).toBe(10);
	});

	test("an app-owned key binds once its app is enabled", () => {
		syncPlanCapState(null, () => undefined, new Set(["@ryu/monitors"]));
		billingAuthOn = true;
		// FREE_TIER_LIMITS.maxMonitors === 5.
		expect(resolveCapLimit("maxMonitors")).toBe(5);
	});

	test("a retention window is a quota like any other (days, not a count)", () => {
		syncPlanCapState(null, () => undefined, new Set(["@ryu/meetings"]));
		billingAuthOn = true;
		expect(resolveCapLimit("meetingRetentionDays")).toBe(30);
		expect(QUOTAS.meetingRetentionDays.unit).toBe("days");
	});

	test("an unsynced app list leaves app-owned keys uncapped (fail open)", () => {
		// No app list passed at all — the plan is known but installs are not, and
		// guessing "not installed" would cap a user who does have the app.
		syncPlanCapState(null, () => undefined);
		billingAuthOn = true;
		expect(resolveCapLimit("maxMonitors")).toBe(Number.POSITIVE_INFINITY);
	});

	test("enforcePlanCap never throws for an app that is not enabled", () => {
		let upgrades = 0;
		syncPlanCapState(
			null,
			() => {
				upgrades += 1;
			},
			new Set<string>()
		);
		billingAuthOn = true;
		expect(() => enforcePlanCap("maxMonitors", 10_000)).not.toThrow();
		expect(upgrades).toBe(0);
	});
});

describe("enforcePlanCap", () => {
	test("under the cap is a silent no-op (no throw, no upgrade prompt)", () => {
		let upgrades = 0;
		syncPlanCapState(null, () => {
			upgrades += 1;
		});
		billingAuthOn = true; // free cap: maxAgents === 10
		expect(() => enforcePlanCap("maxAgents", 9)).not.toThrow();
		expect(upgrades).toBe(0);
	});

	test("at the cap opens the upgrade modal AND throws PlanCapError", () => {
		let upgrades = 0;
		syncPlanCapState(null, () => {
			upgrades += 1;
		});
		billingAuthOn = true;
		let caught: unknown;
		try {
			enforcePlanCap("maxAgents", 10);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(PlanCapError);
		expect((caught as InstanceType<typeof PlanCapError>).field).toBe(
			"maxAgents"
		);
		expect((caught as InstanceType<typeof PlanCapError>).limit).toBe(10);
		expect(upgrades).toBe(1);
	});

	test("throws even when the registered requester is a no-op (cap still holds)", () => {
		syncPlanCapState(null, () => undefined);
		billingAuthOn = true;
		expect(() => enforcePlanCap("maxAgents", 999)).toThrow(PlanCapError);
	});

	test("off the managed path never throws — self-host stays uncapped", () => {
		syncPlanCapState(null, () => undefined);
		billingAuthOn = false;
		expect(() => enforcePlanCap("maxAgents", 10_000)).not.toThrow();
	});
});

describe("PlanCapError", () => {
	test("carries field + limit and a descriptive message", () => {
		const err = new PlanCapError("maxWorkflows", 3);
		expect(err.name).toBe("PlanCapError");
		expect(err.field).toBe("maxWorkflows");
		expect(err.limit).toBe(3);
		expect(err.message).toContain("maxWorkflows");
		expect(err.message).toContain("3");
		expect(err).toBeInstanceOf(Error);
	});
});
