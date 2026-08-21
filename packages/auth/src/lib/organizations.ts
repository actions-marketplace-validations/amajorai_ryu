import { randomUUID } from "node:crypto";
import { User } from "@ryu/db/models/auth.model";
import { Member, Organization } from "@ryu/db/models/control-plane.model";
import { businessEmailDomainDecision } from "./organization-email-policy.ts";
import {
	organizationKindFromMetadata,
	TEAMS_ORGANIZATION_KIND,
} from "./organization-kind.ts";

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
			metadata?: Record<string, unknown>;
			name: string;
			slug: string;
			userId: string;
			keepCurrentActiveOrganization?: boolean;
		};
	}) => Promise<unknown>;
}

export interface OrganizationInvitationApi {
	cancelInvitation: (args: {
		body: { invitationId: string };
		headers: Headers;
	}) => Promise<unknown>;
	listInvitations: (args: {
		query: { organizationId: string };
		headers: Headers;
	}) => Promise<unknown>;
}

export type OrganizationInvitationCancelResult =
	| { changed: boolean; status: "canceled" }
	| { changed: false; status: "accepted" | "rejected" | "expired" }
	| { changed: false; status: "not_found" };

/**
 * Cancel a sender-owned invitation through Better Auth's organization plugin.
 *
 * The list-before-cancel guard is important: Better Auth's mutation is the
 * authoritative write, but its low-level endpoint will mark even a terminal
 * invitation as canceled. We only invoke it for the live pending invitation
 * in the requested organization. Repeating a canceled request is a safe
 * no-op, and an accepted/rejected/expired request is never rewritten.
 */
export async function cancelOrganizationInvitation(
	api: OrganizationInvitationApi,
	args: {
		headers: Headers;
		invitationId: string;
		organizationId: string;
		now?: Date;
	}
): Promise<OrganizationInvitationCancelResult> {
	const response = await api.listInvitations({
		query: { organizationId: args.organizationId },
		headers: args.headers,
	});
	const invitations = Array.isArray(response)
		? response
		: response && typeof response === "object" && "invitations" in response
			? (response as { invitations?: unknown }).invitations
			: null;
	const invitation = Array.isArray(invitations)
		? invitations.find(
				(
					value
				): value is {
					expiresAt?: string | Date;
					id: string;
					status: string;
				} =>
					typeof value === "object" &&
					value !== null &&
					typeof (value as { id?: unknown }).id === "string" &&
					(value as { id: string }).id === args.invitationId
			)
		: undefined;

	if (!invitation) {
		return { changed: false, status: "not_found" };
	}
	if (invitation.status !== "pending") {
		return {
			changed: false,
			status:
				invitation.status === "canceled"
					? "canceled"
					: invitation.status === "accepted"
						? "accepted"
						: "rejected",
		};
	}
	const expiresAt = invitation.expiresAt
		? new Date(invitation.expiresAt).getTime()
		: Number.POSITIVE_INFINITY;
	if (expiresAt <= (args.now ?? new Date()).getTime()) {
		return { changed: false, status: "expired" };
	}

	await api.cancelInvitation({
		body: { invitationId: args.invitationId },
		headers: args.headers,
	});
	return { changed: true, status: "canceled" };
}

/**
 * Idempotently gives a user the default one-person organization. Returns `created: false`
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
 * slug so a freshly-signed-up user always lands in a valid org context. The
 * organization hook owns the final kind marker; a consumer-email account stays
 * personal, while a company-domain account is provisioned into the Teams
 * boundary and must verify before it can add members or check out.
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
	const user = await User.findById(userId)
		.select("email")
		.lean<{ email?: string | null }>();
	const organizationKind = businessEmailDomainDecision(user?.email).allowed
		? "teams"
		: "personal";
	await api.createOrganization({
		body: {
			name: "Personal",
			slug,
			userId,
			metadata: { organizationKind },
			// No session is involved on this server-side path, so don't try to mutate
			// an active organization on a (non-existent) session.
			keepCurrentActiveOrganization: true,
		},
	});

	return { created: true };
}

/**
 * Resolve the earliest membership, which is the codebase's definition of a
 * user's personal organization, unless that same organization has completed a
 * paid in-place conversion to Teams. The conversion keeps the organization id
 * and all data, so every caller that needs personal-vs-shared semantics must
 * honour the durable kind marker rather than treating the first membership as
 * permanently personal.
 */
export async function resolvePersonalOrgId(
	userId: string
): Promise<string | null> {
	const member = await Member.findOne({ userId }).sort({ createdAt: 1 });
	if (!member) {
		return null;
	}
	const organization = await Organization.findById(member.organizationId)
		.select("metadata")
		.lean<{ metadata?: unknown }>();
	return organizationKindFromMetadata(organization?.metadata) ===
		TEAMS_ORGANIZATION_KIND
		? null
		: String(member.organizationId);
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
	/** Create the user's default organization if they have no membership. */
	ensureOrganization: (userId: string) => Promise<void>;
	/** Earliest membership for the user — the default org — or null. */
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
