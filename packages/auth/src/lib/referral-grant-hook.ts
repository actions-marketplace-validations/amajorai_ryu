/**
 * The sign-up seam for the REFEREE's referral credit.
 *
 * WHY A REGISTRY AND NOT AN IMPORT. The grant itself is
 * `grantRefereeReferral` in `@ryu/api/lib/credits`, and it cannot be called from
 * here: `@ryu/api` depends on `@ryu/auth` (see its package.json), so importing it
 * back would invert the dependency, and `@ryu/api` is not even resolvable from
 * this package. The event, though, only exists here — Better Auth fires
 * `databaseHooks.user.create.after` inside `auth.handler`, so `apps/server` has
 * no way to observe a sign-up from outside. A one-slot callback is the only shape
 * that lets the layer that OWNS the event hand it to the layer that owns the
 * money: `apps/server` imports both packages and registers the implementation at
 * boot, next to the other boot side effects.
 *
 * SINGLE SLOT, LAST WINS — not an append-only list. Exactly one implementation
 * exists, and a list would turn a double registration (a re-imported boot module,
 * a test harness) into a double mint attempt. The mint is idempotent, so that
 * would not lose money, but it would spend two round-trips proving it.
 */

/** The implementation `apps/server` registers. Takes the new user's id. */
export type RefereeGrantHook = (input: { userId: string }) => Promise<void>;

let refereeGrantHook: RefereeGrantHook | null = null;

/**
 * Install the referee-grant implementation. Called once, from `apps/server` boot.
 */
export function registerRefereeGrantHook(hook: RefereeGrantHook): void {
	refereeGrantHook = hook;
}

/**
 * Run the registered hook for one new user. NEVER THROWS AND NEVER REJECTS, by
 * construction, because its only caller is the sign-up hook: a referral credit
 * that could fail an account creation would be a $10 gift that costs us the user.
 *
 * A missing registration is a silent no-op, not an error. `@ryu/auth` is loaded
 * on its own by the org backfill script and by tests, where no `@ryu/api` exists
 * to register anything.
 */
export async function runRefereeGrantHook(userId: string): Promise<void> {
	const hook = refereeGrantHook;
	if (!hook) {
		return;
	}
	try {
		await hook({ userId });
	} catch (error) {
		console.error("Failed to grant the referee's referral credit:", error);
	}
}
