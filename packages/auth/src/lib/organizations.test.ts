import { describe, expect, it } from "bun:test";

import { resolveInitialActiveOrganization } from "./organizations.ts";

/**
 * What a new session starts scoped to.
 *
 * The failure this guards against is not "the header says Select organization".
 * Org-scoped control-plane routes REFUSE a caller with no membership — the
 * credits wallet answers 409 on every request and every SSE reconnect — so a
 * session that starts unscoped is an account that cannot use the product, and
 * no client-side retry can clear it.
 *
 * The fix is an ORDER: look up, heal if empty, look up AGAIN. The second lookup
 * is the fragile half, because `ensurePersonalOrganization` reports only whether
 * it created something and never which organization, so a refactor that "returns
 * the ensure result" compiles and silently reinstates the unscoped session.
 * These cases pin the order, which is why the dependencies are injected.
 */
describe("resolveInitialActiveOrganization", () => {
	it("returns the existing membership without writing", async () => {
		let ensureCalls = 0;
		const orgId = await resolveInitialActiveOrganization({
			userId: "user_1",
			findEarliestMembership: () => Promise.resolve("org_existing"),
			ensureOrganization: () => {
				ensureCalls += 1;
				return Promise.resolve();
			},
		});

		expect(orgId).toBe("org_existing");
		// Every login runs this hook; healing an already-healthy user would put a
		// pointless write on the sign-in path.
		expect(ensureCalls).toBe(0);
	});

	it("heals a user with no membership and returns the created org", async () => {
		const lookups: string[] = [];
		let created = false;
		const orgId = await resolveInitialActiveOrganization({
			userId: "user_2",
			findEarliestMembership: (userId) => {
				lookups.push(userId);
				return Promise.resolve(created ? "org_personal" : null);
			},
			ensureOrganization: () => {
				created = true;
				return Promise.resolve();
			},
		});

		// The whole point: an org-less user gets a scoped session, so the 409 the
		// wallet was returning cannot recur for them.
		expect(orgId).toBe("org_personal");
		// Two lookups, not one — the id can only come from the re-query.
		expect(lookups).toEqual(["user_2", "user_2"]);
	});

	it("returns null when the heal produced no membership", async () => {
		const orgId = await resolveInitialActiveOrganization({
			userId: "user_3",
			findEarliestMembership: () => Promise.resolve(null),
			ensureOrganization: () => Promise.resolve(),
		});

		// The caller is fail-open: an unscoped session still beats a blocked login.
		expect(orgId).toBeNull();
	});

	it("propagates a failing heal to the caller's fail-open catch", async () => {
		await expect(
			resolveInitialActiveOrganization({
				userId: "user_4",
				findEarliestMembership: () => Promise.resolve(null),
				ensureOrganization: () =>
					Promise.reject(new Error("organization plugin exploded")),
			})
		).rejects.toThrow("organization plugin exploded");
	});
});
