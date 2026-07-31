import { describe, expect, it } from "bun:test";

import {
	registerRefereeGrantHook,
	runRefereeGrantHook,
} from "./referral-grant-hook.ts";

/**
 * The sign-up seam for the referee's referral credit.
 *
 * What is actually under test is that this can never break an account creation:
 * a missing registration and a throwing implementation must both leave
 * `runRefereeGrantHook` resolved, because its only caller is Better Auth's
 * `user.create.after` hook and a rejection there fails the sign-up.
 *
 * THE SLOT IS MODULE STATE and nothing unregisters it, so the unregistered case
 * has to be asserted FIRST. Moving that test down the file would silently make it
 * assert nothing.
 */
describe("runRefereeGrantHook", () => {
	it("is a silent no-op when nothing is registered", async () => {
		// `@ryu/auth` is loaded on its own by the org backfill script and by tests,
		// where no `@ryu/api` exists to register an implementation.
		expect(await runRefereeGrantHook("user_1")).toBeUndefined();
	});

	it("runs the registered hook once per call, with the new user's id", async () => {
		const calls: string[] = [];
		registerRefereeGrantHook(({ userId }) => {
			calls.push(userId);
			return Promise.resolve();
		});

		await runRefereeGrantHook("user_2");

		expect(calls).toEqual(["user_2"]);
	});

	it("swallows a hook that throws, so sign-up still completes", async () => {
		registerRefereeGrantHook(() => {
			throw new Error("mint exploded");
		});

		expect(await runRefereeGrantHook("user_3")).toBeUndefined();
	});

	it("swallows a hook that rejects", async () => {
		registerRefereeGrantHook(() => Promise.reject(new Error("mongo down")));

		expect(await runRefereeGrantHook("user_4")).toBeUndefined();
	});

	it("keeps only the LAST registration", async () => {
		// One slot, not a list: a double registration (a re-imported boot module, a
		// test harness) must not turn one sign-up into two mint attempts.
		const calls: string[] = [];
		registerRefereeGrantHook(() => {
			calls.push("first");
			return Promise.resolve();
		});
		registerRefereeGrantHook(() => {
			calls.push("second");
			return Promise.resolve();
		});

		await runRefereeGrantHook("user_5");

		expect(calls).toEqual(["second"]);
	});
});
