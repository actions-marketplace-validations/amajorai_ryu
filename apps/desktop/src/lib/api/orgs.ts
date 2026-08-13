// apps/desktop/src/lib/api/orgs.ts
//
// The organizations the signed-in user belongs to, and which one their session
// is currently scoped to. Targets the identity/control-plane server (:3000,
// BACKEND_URL) with the Better-Auth session bearer token, like credits.ts and
// teams-billing.ts.
//
//   GET  /api/control-plane/orgs            -> the caller's orgs, with roles
//   POST /api/auth/organization/set-active  -> rescope THIS session
//   GET  /api/credits/transferable          -> what can move, and where to
//   POST /api/credits/transfer              -> move it
//
// WHY set-active IS THE RIGHT LEVER, and not a per-request org parameter: every
// org-scoped route in the control plane (`/api/credits/*`, `/api/billing/*`,
// `/api/affiliate/*`) resolves its org from `session.activeOrganizationId` and
// falls back to the caller's earliest membership. There is no `?orgId=` on any
// of them. The desktop's bearer token is backed by a REAL Better Auth session
// row — the same row `set-active` writes — so switching once rescopes all of
// them at their existing seam, with nothing to thread through.
//
// The transfer routes are the exception and take explicit org ids, because a
// transfer names two orgs and neither of them is necessarily the active one.

import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

function authToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		// No storage — treated as signed out.
		return null;
	}
}

/** True when there is a session token at all; every route here requires one. */
export function hasOrgAuth(): boolean {
	return Boolean(authToken());
}

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const token = authToken();
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

const BASE = BACKEND_URL.replace(/\/$/, "");

async function readError(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as {
		error?: string;
		message?: string;
	} | null;
	return body?.error ?? body?.message ?? `Request failed (${response.status})`;
}

export interface OrgSummary {
	/** Whether the caller may move credits OUT of this org (owner/admin). */
	canSendFrom: boolean;
	id: string;
	/** True for the caller's personal org — where referral rewards are paid. */
	isPersonal: boolean;
	name: string;
	role: string | null;
	slug: string;
}

export interface TransferableGrant {
	expiresAt: string | null;
	id: string;
	originalMicroUsd: number;
	pool: string;
	remainingMicroUsd: number;
}

export interface TransferableView {
	orgs: OrgSummary[];
	source: {
		grants: TransferableGrant[];
		orgId: string;
		topupMicroUsd: number;
	} | null;
}

export interface OrgListEntry {
	createdAt: string | null;
	id: string;
	/**
	 * True for the caller's personal workspace. Server-computed (earliest
	 * membership) rather than derived here from the slug, so there is one rule
	 * for it rather than a desktop copy that can drift — the same field, from the
	 * same helper, that `/api/credits/transferable` puts on {@link OrgSummary}.
	 */
	isPersonal: boolean;
	/**
	 * The org's uploaded logo, exactly as the web dashboard's settings dialog
	 * writes it. `null` when nobody has set one, which is a real answer and not a
	 * failure: the UI falls back to the generative avatar seeded by `id`, the same
	 * placeholder the web shows.
	 */
	logo: string | null;
	name: string;
	role: string | null;
	slug: string;
}

/** The orgs the caller belongs to. Empty when signed out. */
export async function listOrgs(): Promise<OrgListEntry[]> {
	if (!authToken()) {
		return [];
	}
	const response = await fetch(`${BASE}/api/control-plane/orgs`, {
		headers: authHeaders(),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	const body = (await response.json()) as {
		organizations?: Partial<OrgListEntry>[];
	};
	// Normalized rather than cast straight through: the desktop talks to whatever
	// control plane it is pointed at, and one older than the field is a plausible
	// pairing. `undefined` reaching `EntityAvatar` as `src` would be harmless, but
	// `isPersonal` deciding a branch on `undefined` is not — spell both out here
	// so the rest of the app sees the declared shape.
	return (body.organizations ?? []).map((org) => ({
		createdAt: org.createdAt ?? null,
		id: org.id ?? "",
		isPersonal: org.isPersonal ?? false,
		logo: org.logo ?? null,
		name: org.name ?? "",
		role: org.role ?? null,
		slug: org.slug ?? "",
	}));
}

/**
 * The org THIS session is scoped to, read back from Better Auth's session
 * payload rather than cached locally.
 *
 * Deliberately a server read: the same account may be signed in on the web and
 * in another desktop window, and a locally remembered id would keep showing the
 * org this window last picked while every API response came back scoped to a
 * different one — a switcher that lies is worse than no switcher.
 */
export async function getActiveOrgId(): Promise<string | null> {
	if (!authToken()) {
		return null;
	}
	const response = await fetch(`${BASE}/api/auth/get-session`, {
		headers: authHeaders(),
	});
	if (!response.ok) {
		return null;
	}
	const body = (await response.json().catch(() => null)) as {
		session?: { activeOrganizationId?: string | null };
	} | null;
	return body?.session?.activeOrganizationId ?? null;
}

/** Rescope this session to `organizationId`. */
export async function setActiveOrg(organizationId: string): Promise<void> {
	const response = await fetch(`${BASE}/api/auth/organization/set-active`, {
		body: JSON.stringify({ organizationId }),
		headers: authHeaders(),
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
}

/** What the caller can move, and the orgs they can move it between. */
export async function fetchTransferable(
	orgId?: string | null
): Promise<TransferableView> {
	const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
	const response = await fetch(`${BASE}/api/credits/transferable${query}`, {
		headers: authHeaders(),
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	return (await response.json()) as TransferableView;
}

export interface TransferResult {
	movedGrantIds: string[];
	movedGrantMicroUsd: number;
	movedTopupMicroUsd: number;
	ok: boolean;
	reason: string | null;
}

/** Move grants and/or top-up balance between two orgs the caller belongs to. */
export async function transferCredits(input: {
	fromOrgId: string;
	grantIds?: string[];
	toOrgId: string;
	topupMicroUsd?: number;
}): Promise<TransferResult> {
	const response = await fetch(`${BASE}/api/credits/transfer`, {
		body: JSON.stringify(input),
		headers: authHeaders(),
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(await readError(response));
	}
	return (await response.json()) as TransferResult;
}
