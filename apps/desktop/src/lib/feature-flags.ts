// apps/desktop/src/lib/feature-flags.ts
//
// The active account's server-driven ROLLOUT flags, mirrored locally so a
// surface can read one synchronously and refresh it without a restart.
//
// WHAT A FLAG IS AND IS NOT. These are rollout/discovery switches
// (`@ryu/auth/lib/feature-flags`), a different axis from entitlement: what has
// been switched ON for you, not what you have paid for. Nothing here may ever
// reach `decideDesktopAccess`, the paywall verdict, or the cached entitlement —
// the same firewall `updates-window.ts` keeps, and for the same reason.
//
// Why localStorage rather than the entitlement context, exactly as
// `updates-window.ts` argues: this is a synchronous value a component reads at
// render time, without prop-threading or awaiting a resolve, and the last-known
// value has to survive an offline launch.
//
// Why every read is SCOPED to the active account: signing out clears the auth
// vault (`ryu_accounts` / `ryu_active_user_id`) but not this key. An unscoped
// cached "card visible" from account A would leak straight to account B on the
// same machine — showing them a surface that was rolled out to someone else.
// Scoping on READ makes sign-out, full logout and account switching all correct
// without a single teardown call.
//
// THE FAIL DIRECTION, which is not a blanket rule. `lib/api/billing.ts` opens by
// rejecting "money fails closed" as a blanket: resolving an OUTAGE to false
// falsely locks out a real paying user. So:
//   - never known at all       -> the compiled-in `featureFlagFallback(key)`
//   - known, then a check FAILED -> ride the last-good value stored here
// A failed refresh therefore writes NOTHING. `publishFeatureFlags(null)` is
// reserved for "the check succeeded and carried no flags", not for an outage.

import { getActiveUserId } from "@/lib/auth-client.ts";
import { fetchEntitlementSnapshot } from "@/src/lib/api/billing.ts";

/** localStorage key: `{ accountId, features, fetchedAtMs }` for the active account. */
const FEATURE_FLAGS_KEY = "ryu.feature-flags";

/**
 * How long a fetched map is served before a reader triggers a refresh.
 *
 * Deliberately the same 60s as `POSITIVE_TTL` in
 * `apps/gateway/src/policy/cache.rs`, so the two caches of control-plane policy
 * are visibly ONE choice about how stale a flip may be, not two numbers that
 * drifted apart. Change one, change the other.
 */
const FEATURE_FLAGS_TTL_MS = 60_000;

interface FlagsRecord {
	accountId: string;
	features: Record<string, boolean>;
	fetchedAtMs: number;
}

/**
 * In-memory mirror of the stored record, so the common case (several components
 * reading a flag in one render pass) costs no JSON parse.
 */
let cached: FlagsRecord | null = null;

/**
 * The refresh currently in flight, shared by every concurrent caller OF THIS
 * MODULE.
 *
 * Load-bearing, not a micro-optimization. `fetchEntitlementSnapshot()` hits
 * `/subscription-status`, whose handler paginates EVERY Polar order for the
 * customer, so two components mounting in the same frame would otherwise each
 * start their own full pagination. Bounding refreshes by user action is only
 * half the guarantee; this is the other half.
 *
 * SCOPE, precisely — do not read more into it than it does. `useEntitlement`
 * calls `fetchEntitlementSnapshot()` DIRECTLY (it needs the whole snapshot, not
 * just the flags) and publishes through `publishFeatureFlags`, bypassing this
 * latch entirely. So a cold start where the dialog is opened before the
 * app-entry resolve lands still issues TWO requests. That overlap is accepted:
 * it is bounded at one extra request, once, per launch — whereas the hook-to-
 * hook fan-out this DOES cover is unbounded in the number of mounted readers.
 * Do not "fix" it by routing `useEntitlement` through here; its snapshot feeds
 * the paywall verdict and must not be served from a flag cache.
 */
let inFlight: Promise<void> | null = null;

/** Read the stored record, but only when it belongs to the account signed in NOW. */
function readRecord(): FlagsRecord | null {
	const activeId = getActiveUserId();
	// No signed-in account means nothing can legitimately own the record; compare
	// explicitly so a corrupted `accountId: null` cannot match.
	if (activeId === null) {
		return null;
	}
	if (cached && cached.accountId === activeId) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(FEATURE_FLAGS_KEY);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		const features = record.features;
		if (
			record.accountId !== activeId ||
			typeof features !== "object" ||
			features === null
		) {
			return null;
		}
		const fetchedAtMs =
			typeof record.fetchedAtMs === "number" ? record.fetchedAtMs : 0;
		cached = {
			accountId: activeId,
			features: features as Record<string, boolean>,
			fetchedAtMs,
		};
		return cached;
	} catch {
		return null;
	}
}

/**
 * Publish a map the control plane just served. Call this ONLY after a check that
 * SUCCEEDED — `null` means "checked, and this caller carries no flags", never
 * "could not check". A failed check must leave the stored record alone so the
 * last-good value keeps riding (see the fail-direction note at the top).
 *
 * Best-effort: storage failures are swallowed so a blocked or full store can
 * never break the entitlement resolve that called us.
 */
export function publishFeatureFlags(map: Record<string, boolean> | null): void {
	const accountId = getActiveUserId();
	if (accountId === null) {
		return;
	}
	const record: FlagsRecord = {
		accountId,
		features: map ?? {},
		fetchedAtMs: Date.now(),
	};
	cached = record;
	try {
		localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(record));
	} catch {
		// Persistence is best-effort; the in-memory mirror still serves this run.
	}
}

/**
 * The active account's value for a flag, or `null` when it has NEVER been
 * successfully read. Null is what makes the compiled-in default reachable —
 * callers must not collapse it to `false` themselves.
 */
export function readFeatureFlag(key: string): boolean | null {
	const value = readRecord()?.features[key];
	return typeof value === "boolean" ? value : null;
}

/**
 * Whether the stored map is absent or older than the TTL. A record that was
 * never written is stale by definition — that is what makes the first read of a
 * surface fetch one.
 */
export function isFeatureFlagStale(): boolean {
	const record = readRecord();
	if (record === null) {
		return true;
	}
	// A clock that moved backwards must not pin the cache as "fresh forever".
	const ageMs = Date.now() - record.fetchedAtMs;
	return !(ageMs >= 0 && ageMs < FEATURE_FLAGS_TTL_MS);
}

/**
 * Refresh the map from the control plane, sharing one request across concurrent
 * callers. Resolves when the attempt finishes — successfully or not; a FAILED
 * check publishes nothing, by design.
 *
 * Bounded by user action (a surface mounting), never by a background timer. A
 * timer would put every installed client on the Polar-paginating
 * `/subscription-status` handler every 60s, and a Polar hiccup would then read
 * as "flag unknown" fleet-wide. The tradeoff is honest and deliberate: a flip
 * propagates within one TTL of a surface being OPENED, with no upper bound on
 * staleness for a client that never opens it.
 */
export function refreshFeatureFlags(): Promise<void> {
	if (inFlight) {
		return inFlight;
	}
	inFlight = fetchEntitlementSnapshot()
		.then((snapshot) => {
			// `snapshot === null` is a FAILED check (offline / 5xx / signed out).
			// Leave the stored record untouched so last-good keeps riding.
			if (snapshot) {
				publishFeatureFlags(snapshot.features);
			}
		})
		.catch(() => {
			// Same as a null snapshot: an outage never rewrites the cache.
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}
