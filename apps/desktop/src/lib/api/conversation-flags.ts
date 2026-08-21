// apps/desktop/src/lib/api/conversation-flags.ts
//
// Typed client for the server-backed pin/archive flags on a conversation
// (`POST /api/conversations/:id/pinned` and `/archived`). These write the same
// columns the coordinator `threads` tool sets, so a pin made in the desktop
// surfaces to every client (and a coordinator-pinned worker thread shows here).
//
// Both calls are best-effort: they resolve to `false` on any transport failure
// so the caller can keep its optimistic local state and not block the UI. The
// localStorage mirror in the sidebar remains the offline fallback.

import type { ResourceVisibility } from "@/src/lib/resource-visibility.ts";
import { type ApiTarget, request } from "./client.ts";

async function setFlag(
	target: ApiTarget,
	id: string,
	flag: "pinned" | "archived",
	value: boolean
): Promise<boolean> {
	try {
		await request<{ ok?: boolean }>(
			target,
			`/api/conversations/${encodeURIComponent(id)}/${flag}`,
			{ method: "POST", body: { value } }
		);
		return true;
	} catch {
		return false;
	}
}

/** Pin or unpin a conversation server-side. Resolves false on failure. */
export function setConversationPinned(
	target: ApiTarget,
	id: string,
	value: boolean
): Promise<boolean> {
	return setFlag(target, id, "pinned", value);
}

/** Archive or unarchive a conversation server-side. Resolves false on failure. */
export function setConversationArchived(
	target: ApiTarget,
	id: string,
	value: boolean
): Promise<boolean> {
	return setFlag(target, id, "archived", value);
}

/**
 * Manually rename a conversation server-side (`POST /api/conversations/:id/title`).
 * Marks the title user-chosen so auto-rename never overwrites it. Resolves false
 * on any transport failure so the caller can keep its optimistic local title and
 * not block the UI.
 */
export async function setConversationTitle(
	target: ApiTarget,
	id: string,
	title: string
): Promise<boolean> {
	try {
		await request<{ ok?: boolean }>(
			target,
			`/api/conversations/${encodeURIComponent(id)}/title`,
			{ method: "POST", body: { title } }
		);
		return true;
	} catch {
		return false;
	}
}

/** One past title for a conversation (`GET /api/conversations/:id/title-history`). */
export interface TitleHistoryEntry {
	createdAt: number;
	id: string;
	/** `"auto"` | `"user"` | `"derived"`. */
	source: string;
	title: string;
}

/**
 * Fetch title history for a conversation (oldest → newest). Returns `[]` on
 * failure so hover previews stay quiet.
 */
export async function getConversationTitleHistory(
	target: ApiTarget,
	id: string
): Promise<TitleHistoryEntry[]> {
	try {
		const res = await request<{
			history?: Array<{
				created_at?: number;
				id?: string;
				source?: string;
				title?: string;
			}>;
		}>(target, `/api/conversations/${encodeURIComponent(id)}/title-history`);
		const rows = Array.isArray(res.history) ? res.history : [];
		return rows.flatMap((row) => {
			if (
				typeof row.id !== "string" ||
				typeof row.title !== "string" ||
				typeof row.source !== "string" ||
				typeof row.created_at !== "number"
			) {
				return [];
			}
			return [
				{
					id: row.id,
					title: row.title,
					source: row.source,
					createdAt: row.created_at,
				},
			];
		});
	} catch {
		return [];
	}
}

/**
 * Set or clear a conversation glyph (`POST /api/conversations/:id/icon`).
 * Resolves false on any transport failure so the caller can keep its optimistic
 * local glyph and not block the UI.
 */
export async function setConversationIcon(
	target: ApiTarget,
	id: string,
	icon: unknown | null
): Promise<boolean> {
	try {
		await request<{ ok?: boolean }>(
			target,
			`/api/conversations/${encodeURIComponent(id)}/icon`,
			{ method: "POST", body: { icon } }
		);
		return true;
	} catch {
		return false;
	}
}

/** Set a conversation's private or shared visibility. */
export async function setConversationVisibility(
	target: ApiTarget,
	id: string,
	visibility: ResourceVisibility,
	teamId?: string | null
): Promise<boolean> {
	try {
		await request<{ ok?: boolean }>(
			target,
			`/api/conversations/${encodeURIComponent(id)}/visibility`,
			{
				method: "POST",
				body: {
					visibility,
					...(visibility === "team" && teamId ? { team_id: teamId } : {}),
				},
			}
		);
		return true;
	} catch {
		return false;
	}
}
