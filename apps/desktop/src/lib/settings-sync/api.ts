// Typed client for the settings-sync routes on the control-plane server
// (:3000, BACKEND_URL), authenticated with the Better Auth session bearer —
// the same transport `campaigns.ts` and `billing.ts` use.
//
// NOT a Core node call. Settings sync is account-scoped by definition: the whole
// point is that a second machine, with its own Core, sees what the first one
// saved. A node-scoped store could not do that.

import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

const BASE = `${BACKEND_URL.replace(/\/$/, "")}/api/desktop-settings-sync`;

export interface SyncEntry {
	deleted?: boolean;
	key: string;
	updatedAt: number;
	value: string | null;
}

export interface PullResult {
	entries: SyncEntry[];
	revision: number;
	updatedAt: number;
}

export interface PushResult {
	applied: string[];
	/** The server's newer version of each key this push was too old for. */
	rejected: SyncEntry[];
	revision: number;
	updatedAt: number;
}

function authToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		// No storage — treated as signed out.
		return null;
	}
}

function headers(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

/**
 * Everything changed at or after `since`. Returns null when signed out or the
 * server is unreachable — sync is an enhancement, never a reason for the app to
 * report an error at the user.
 */
export async function pullSettings(since = 0): Promise<PullResult | null> {
	const token = authToken();
	if (!token) {
		return null;
	}
	try {
		const resp = await fetch(`${BASE}/pull?since=${since}`, {
			headers: headers(token),
		});
		if (!resp.ok) {
			return null;
		}
		return (await resp.json()) as PullResult;
	} catch {
		return null;
	}
}

/** Merge a batch upward. Null on failure, so the caller keeps its dirty set. */
export async function pushSettings(
	entries: SyncEntry[]
): Promise<PushResult | null> {
	const token = authToken();
	if (!token || entries.length === 0) {
		return null;
	}
	try {
		const resp = await fetch(`${BASE}/push`, {
			method: "POST",
			headers: headers(token),
			body: JSON.stringify({ entries }),
		});
		if (!resp.ok) {
			return null;
		}
		return (await resp.json()) as PushResult;
	} catch {
		return null;
	}
}

/** Forget the server-side copy entirely. Local settings are untouched. */
export async function resetRemoteSettings(): Promise<boolean> {
	const token = authToken();
	if (!token) {
		return false;
	}
	try {
		const resp = await fetch(BASE, {
			method: "DELETE",
			headers: headers(token),
		});
		return resp.ok;
	} catch {
		return false;
	}
}

/**
 * A best-effort flush that survives the window going away.
 *
 * `keepalive: true` rather than `navigator.sendBeacon`: a beacon cannot carry an
 * Authorization header, and this API authenticates by bearer only — a beacon
 * would be queued, delivered, and 401'd, which is worse than not sending it,
 * because it looks like it worked. Keepalive fetch keeps the header and is
 * allowed to outlive the document.
 *
 * Errors are swallowed: this runs while the window is closing, where there is
 * nobody left to tell.
 */
export function flushSettings(entries: SyncEntry[]): void {
	const token = authToken();
	if (!token || entries.length === 0) {
		return;
	}
	try {
		void fetch(`${BASE}/push`, {
			method: "POST",
			headers: headers(token),
			body: JSON.stringify({ entries }),
			keepalive: true,
		}).catch(() => undefined);
	} catch {
		// Nothing to do — the window is going away.
	}
}
