// apps/desktop/src/lib/api/managed-nodes.ts
//
// Typed client for the org's managed (Ryu Cloud) nodes (A4 / #501).
//
// Like credits.ts / channels.ts (and unlike the Core-node clients), this targets
// the identity/control-plane server (:3000, BACKEND_URL), authenticated with the
// Better-Auth session bearer token. "Which managed nodes my org can reach" is a
// shared/owned registry fact, so it lives in the control plane, not a local Core
// node. Each node is a GatewayCredential that advertised a `reachableUrl` on its
// `/gateway/resolve` handshake; the server resolves the caller's active org from
// the session, so this route takes no org argument.
//
//   GET /api/control-plane/nodes -> the active org's reachable managed nodes
//
// Hydration is best-effort: a signed-out user, a user without an org, or an
// older server without the route all degrade to an empty list (never an error),
// so the NodeSelector keeps its local + LAN + mesh nodes regardless.

import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

/** One managed node the active org can reach, as returned by the control plane. */
export interface ManagedNode {
	id: string;
	/** Last time the node was seen (its last `/gateway/resolve`), ISO string. */
	lastSeenAt: string | null;
	name: string;
	orgId: string;
	orgName: string | null;
	/** Personal owner, when this is a personal node. */
	ownerUserId?: string | null;
	/** Scope returned by the control plane's visibility filter. */
	scope?: "org" | "team" | "personal";
	/**
	 * The managed-server row this node runs on, or null when it has none.
	 *
	 * A DIFFERENT id from `id` above, which is the node's GatewayCredential.
	 * Anything addressing `/api/servers/orgs/:orgId/servers/:serverId/...` — the
	 * resize and quiet-hour-zone surfaces — needs this one and cannot derive it.
	 *
	 * Null is a real answer, not a missing field: adopted and resumed nodes are
	 * never linked to a server row, so a surface that needs it must render its
	 * absence rather than guess.
	 */
	serverId?: string | null;
	/** Team scope, when this is a team node. */
	teamId?: string | null;
	/** Publicly-reachable Core base URL the node advertised on registration. */
	url: string;
	/**
	 * Short-lived Better Auth user JWT for the selected managed node. The
	 * control plane returns one at the response-envelope level; this client
	 * copies it onto each node so request construction stays local. It is
	 * distinct from a self-hosted node bearer and is never persisted as one.
	 */
	userJwt: string | null;
}

const NODES_URL = `${BACKEND_URL.replace(/\/$/, "")}/api/control-plane/nodes`;

/**
 * Fetch the active org's reachable managed nodes. `null` means the scope could
 * not be refreshed; an empty array is a successful response with no reachable
 * nodes. Keeping those states distinct lets the node store remove nodes that
 * left the user's scope without wiping them during an offline refresh.
 */
export async function fetchManagedNodes(): Promise<ManagedNode[] | null> {
	let token: string | null = null;
	try {
		token = localStorage.getItem(TOKEN_KEY);
	} catch {
		// No storage available — treat as signed out.
	}
	if (!token) {
		return null;
	}

	try {
		const resp = await fetch(NODES_URL, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!resp.ok) {
			return null;
		}
		const json = (await resp.json()) as {
			nodes?: Array<ManagedNode & { token?: string | null }>;
			token?: string | null;
			userJwt?: string | null;
		};
		const list = Array.isArray(json.nodes) ? json.nodes : [];
		// New responses name this credential explicitly. Read the old `token`
		// spelling for one release so an older control plane still hydrates, but
		// never expose that ambiguous name in the desktop model.
		const shared =
			typeof json.userJwt === "string"
				? json.userJwt
				: typeof json.token === "string"
					? json.token
					: null;
		return list.map(({ token: legacyToken, ...node }) => ({
			...node,
			userJwt:
				typeof node.userJwt === "string"
					? node.userJwt
					: typeof legacyToken === "string"
						? legacyToken
						: shared,
		}));
	} catch {
		// Server unreachable / offline — degrade to no managed nodes.
		return null;
	}
}
