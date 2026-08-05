import { randomUUID } from "node:crypto";
import { Member } from "@ryu/db/models/control-plane.model";

/**
 * The single organization-plugin endpoint this module needs. `auth.api` is
 * typed via deep inference that collapses when the betterAuth options have any
 * pre-existing type error, so we narrow to just `createOrganization` at the call
 * site (the org plugin guarantees it at runtime) rather than depending on the
 * full inferred surface.
 */
export interface OrganizationApi {
	createOrganization: (args: {
		body: {
			name: string;
			slug: string;
			userId: string;
			keepCurrentActiveOrganization?: boolean;
		};
	}) => Promise<unknown>;
}

/**
 * Idempotently gives a user a personal organization. Returns `created: false`
 * without writing when the user already has any membership, so this is safe to
 * call from the sign-up hook (which may fire more than once) and to re-run from
 * the backfill script after a partial failure.
 *
 * Server-side path: passes `userId` with no session headers, which the org
 * plugin uses to create the org on that user's behalf and assign them the
 * configured `creatorRole` ("owner") plus the backing `member` row — the
 * control plane's single source of truth for membership.
 *
 * Org naming is intentionally generic ("Personal") with a random, collision-free
 * slug so a freshly-signed-up user always lands in a valid org context.
 */
export async function ensurePersonalOrganization(
	userId: string,
	api: OrganizationApi
): Promise<{ created: boolean }> {
	const existing = await Member.findOne({ userId }).lean();
	if (existing) {
		return { created: false };
	}

	const slug = `personal-${randomUUID()}`;
	await api.createOrganization({
		body: {
			name: "Personal",
			slug,
			userId,
			// No session is involved on this server-side path, so don't try to mutate
			// an active organization on a (non-existent) session.
			keepCurrentActiveOrganization: true,
		},
	});

	return { created: true };
}

/**
 * Decide which organization a NEW SESSION starts scoped to, healing the user
 * first if they have none.
 *
 * Every org-scoped read in the control plane resolves membership through the
 * `member` collection, so a user with zero rows there is not merely unscoped —
 * they are permanently refused. `GET /api/credits/wallet` answers 409 ("no
 * active organization") on every request and every SSE reconnect, for the life
 * of the session, and no client retry can clear it.
 *
 * `ensurePersonalOrganization` already runs in the sign-up hook, but that hook
 * is deliberately FAIL-OPEN — it logs and lets sign-up succeed — so a transient
 * error there mints an account that is org-less forever. Users created before
 * auto-provisioning landed are in the same state. Session create is the right
 * place to repair both: it is the one moment every affected user passes through,
 * it happens once per login rather than per request, and it fixes every
 * org-scoped surface at once instead of one route at a time.
 *
 * Dependency-injected rather than reaching for `Member` and `auth.api` directly:
 * the ORDER here (look up → ensure → look up AGAIN) is the entire fix, and the
 * re-query is easy to drop in a refactor because `ensurePersonalOrganization`
 * reports only whether it created something, never which org. Injecting lets
 * that order be asserted without a database.
 *
 * Returns null only when the heal itself failed to produce a membership; the
 * caller stays fail-open and lets the session start unscoped rather than
 * blocking login.
 */
export async function resolveInitialActiveOrganization(deps: {
	/** Create the user's personal organization if they have no membership. */
	ensureOrganization: (userId: string) => Promise<void>;
	/** Earliest membership for the user — the personal org — or null. */
	findEarliestMembership: (userId: string) => Promise<string | null>;
	userId: string;
}): Promise<string | null> {
	const existing = await deps.findEarliestMembership(deps.userId);
	if (existing) {
		// The overwhelmingly common path: one read, no write, on every login.
		return existing;
	}
	await deps.ensureOrganization(deps.userId);
	// `ensureOrganization` reports creation, not identity, so the id has to come
	// from a second read.
	return await deps.findEarliestMembership(deps.userId);
}
