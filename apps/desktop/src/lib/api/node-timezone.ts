// apps/desktop/src/lib/api/node-timezone.ts
//
// A managed node's quiet-hour time zone, read and written on the CONTROL PLANE.
//
// Unlike `lib/api/update.ts` — which talks to a node's own Core — this targets
// the identity/control-plane server (BACKEND_URL) with the Better-Auth session
// bearer, the same idiom as `org.ts` / `managed-nodes.ts`. "Which zone this
// node's night is in" is a registry fact about a server row the control plane
// owns, not something the node itself stores.
//
// WHY THE ZONE IS PER NODE AND NOT PER ORG: an org running one node in
// Frankfurt and another in Singapore has two different nights. A single
// org-level zone would schedule a restart into one of the two working days
// every time.
//
// THE ROUTE NEEDS TWO IDS THE DESKTOP USED TO THROW AWAY. `orgId` and
// `serverId` are carried on `Node` (see `useNodeStore.ts`), because `serverId`
// is a `ProvisionedServer._id` — a different id space from the
// `GatewayCredential._id` the node list calls `id`, and not derivable from it.
// Adopted and resumed nodes have no server row at all; `serverId` is null for
// them and the surface must hide itself rather than guess a row by URL, which
// would write one node's settings onto another's.

import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

/** What both endpoints below answer with. */
export interface NodeTimeZone {
	/** What the node reported from its own clock. Null until it has handshaked. */
	detectedTimeZone: string | null;
	/**
	 * The zone the quiet hour is ACTUALLY measured in, after precedence
	 * (`timeZone` → `detectedTimeZone` → `UTC`). This is what a surface should
	 * show: the override is null on a correctly-configured node, so rendering it
	 * directly would render a blank.
	 */
	effectiveTimeZone: string;
	/** The explicit human choice, or null when the node's own report is used. */
	timeZone: string | null;
}

/** Carries the server's own message, so a 403 explains it needs an admin. */
export class NodeTimeZoneError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "NodeTimeZoneError";
		this.status = status;
	}
}

function serversBase(): string {
	return `${BACKEND_URL.replace(/\/$/, "")}/api/servers`;
}

function authToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const token = authToken();
	if (!token) {
		throw new NodeTimeZoneError(401, "Sign in to manage this node.");
	}
	const resp = await fetch(`${serversBase()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
		},
	});
	if (!resp.ok) {
		// The server's own sentence is far more useful than a status code here:
		// "requires admin role" and "not a recognised IANA time zone" are both
		// things the person looking at the row can act on.
		const body = (await resp.json().catch(() => null)) as {
			message?: string;
		} | null;
		throw new NodeTimeZoneError(
			resp.status,
			body?.message ?? `Request failed: ${resp.status}`
		);
	}
	return (await resp.json()) as T;
}

/**
 * Read a managed node's zone. Member-readable — knowing when the node restarts
 * is exactly what everyone whose agents run on it needs to see, not just the
 * admin who can change it.
 */
export function getNodeTimeZone(
	orgId: string,
	serverId: string
): Promise<NodeTimeZone> {
	return request<NodeTimeZone>(`/orgs/${orgId}/servers/${serverId}`);
}

/**
 * Set (or clear) the override. Requires org admin; a member gets a 403 whose
 * message says so.
 *
 * Passing `null` CLEARS the override and returns the node to whatever it reports
 * for itself, which is the sane default — a machine in Frankfurt already knows
 * it is in Frankfurt. Clearing is a first-class action rather than something you
 * approximate by picking the zone you believe the node is in.
 */
export function setNodeTimeZone(
	orgId: string,
	serverId: string,
	timeZone: string | null
): Promise<NodeTimeZone> {
	return request<NodeTimeZone>(`/orgs/${orgId}/servers/${serverId}/timezone`, {
		method: "PATCH",
		body: JSON.stringify({ timeZone }),
	});
}

/**
 * The zone list offered by the picker.
 *
 * `Intl.supportedValuesOf` is the full IANA set the runtime already ships;
 * the short list is a fallback for a runtime that does not expose it, chosen to
 * cover the regions nodes are actually provisioned in rather than to be
 * complete — a partial list beats an empty picker.
 */
export const NODE_TIME_ZONES: string[] = (() => {
	try {
		const values = Intl.supportedValuesOf?.("timeZone");
		if (values && values.length > 0) {
			return [...values];
		}
	} catch {
		// Older runtime — fall through to the short list.
	}
	return [
		"UTC",
		"America/Los_Angeles",
		"America/New_York",
		"Europe/London",
		"Europe/Berlin",
		"Asia/Singapore",
		"Asia/Tokyo",
		"Australia/Sydney",
	];
})();
