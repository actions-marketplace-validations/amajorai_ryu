// apps/desktop/src/lib/api/drafts.ts
//
// Typed client for the `@ryu/drafts` sidecar — the durable outbox.
//
// Data path: `/api/drafts/*` DIRECTLY. The app's manifest declares
// `http.public_mount`, so Core mounts the sidecar at that prefix and the longer
// `/api/ext/@ryu/drafts/*` form is not needed. Every path used below must also
// appear in the manifest's `http.routes[]` — Core's ext-proxy 404s an undeclared
// path before it ever reaches the sidecar.
//
// THE SEND IS NOT HERE. A manifest sidecar holds no `RYU_TOKEN`, so it cannot reach
// Core's chat API directly — but it does not need to: it sends through the granted
// `chat.startTurn` kernel capability, from its own dispatcher
// (`apps-store/drafts/backend/src/dispatch.rs`). That is what makes a queued draft
// go out with no window open. This client is only the UI's view of the store.

import { type ApiTarget, request } from "./client.ts";

/** The app's manifest id. Must match Core's `plugins::builtins::DRAFTS_PLUGIN_ID`. */
export const DRAFTS_PLUGIN_ID = "@ryu/drafts";

/** The id of the app's sidebar button whose `target` the page mounts at. The id is
 *  the stable join key; the target is the part the app may move. */
export const DRAFTS_BUTTON_ID = "home";

/** The path the manifest currently declares. A cold-start default for callers that
 *  cannot read the live contributions feed — never a second source of truth (see
 *  `useAppShellPath`). */
export const DRAFTS_DEFAULT_PATH = "/drafts";

const BASE = "/api/drafts";

// ── wire shapes (snake_case, mirroring the Rust structs) ──────────────────────

export type DraftState = "draft" | "armed" | "sending" | "sent" | "failed";
export type DraftSource = "composer-autosave" | "manual" | "auto-queue";

export type DraftTrigger =
	| { kind: "manual" }
	| { below: number; kind: "concurrency" }
	/** Send once the node has been seen BUSY and then goes quiet. Not the same as
	 *  `concurrency { below: 1 }`, which fires immediately on an already-idle node —
	 *  see `Trigger::AllDone` in the sidecar for why the transition matters. */
	| { kind: "all_done" }
	| { agent_id: string; below_percent: number; kind: "usage_reset" }
	| { epoch_ms: number; kind: "at" };

/** One draft, as the sidecar serves it: the row plus the three presentation fields
 *  the declarative sidebar `map` projects (`preview` / `state_label` /
 *  `waiting_for`), which are computed server-side because a manifest spec has no
 *  expression language. */
export interface DraftWire {
	agent_id?: string;
	claimed_at?: number;
	conversation_id?: string;
	created_at: number;
	error?: string;
	folder_path?: string;
	id: string;
	model?: string;
	preview: string;
	sent_at?: number;
	source: DraftSource;
	state: DraftState;
	state_label: string;
	text: string;
	trigger: DraftTrigger;
	updated_at: number;
	waiting_for: string;
}

export interface DraftsSettings {
	auto_queue_enabled: boolean;
	autosave_enabled: boolean;
	autosave_min_chars: number;
	max_concurrent: number;
}

/** One reading of the node, taken by the dispatcher. An ABSENT field means
 *  "unknown", and the sidecar holds every draft that depends on it rather than
 *  firing on a default — see `Trigger::is_satisfied`. */
export interface DraftReadings {
	running?: number;
	/** `agent id → that agent's fullest usage window, in percent used`. */
	usage?: Record<string, number>;
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Every draft that has not been sent, newest first. */
export async function listDrafts(target: ApiTarget): Promise<DraftWire[]> {
	const body = await request<{ drafts: DraftWire[] }>(target, `${BASE}/list`);
	return body?.drafts ?? [];
}

/** Drafts already sent, newest first. */
export async function listSentDrafts(
	target: ApiTarget,
	limit = 50
): Promise<DraftWire[]> {
	const body = await request<{ drafts: DraftWire[] }>(
		target,
		`${BASE}/drafts?limit=${limit}`
	);
	return body?.drafts ?? [];
}

/**
 * The armed drafts whose condition the supplied readings satisfy, oldest first.
 *
 * The readings ride on the query string rather than being pushed and stored: a
 * pushed snapshot goes stale between the push and the poll, and the dispatcher is
 * the only thing that can act on the answer anyway.
 */
export async function fetchReadyDrafts(
	target: ApiTarget,
	readings: DraftReadings
): Promise<DraftWire[]> {
	const params = new URLSearchParams();
	if (readings.running !== undefined) {
		params.set("running", String(readings.running));
	}
	for (const [agent, percent] of Object.entries(readings.usage ?? {})) {
		// Repeated key, one per agent. `agent` may itself contain a colon
		// (`acp:claude-code`), which is why the sidecar splits on the LAST one.
		params.append("usage", `${agent}:${percent}`);
	}
	const query = params.toString();
	const body = await request<{ drafts: DraftWire[] }>(
		target,
		query ? `${BASE}/queue?${query}` : `${BASE}/queue`
	);
	return body?.drafts ?? [];
}

export async function getDraftsSettings(
	target: ApiTarget
): Promise<DraftsSettings> {
	const body = await request<{ settings: DraftsSettings }>(
		target,
		`${BASE}/settings`
	);
	return body.settings;
}

// ── writes ───────────────────────────────────────────────────────────────────

export interface SaveDraftInput {
	agent_id?: string;
	conversation_id?: string;
	folder_path?: string;
	/** Supply it to keep editing ONE draft (what the composer autosave does)
	 *  instead of leaving a trail of one draft per typing pause. */
	id?: string;
	model?: string;
	source?: DraftSource;
	text: string;
	trigger?: DraftTrigger;
}

/** Create or replace a draft. Blank text deletes it and resolves to `null` — that
 *  is the user clearing the composer, not an error. */
export async function saveDraft(
	target: ApiTarget,
	input: SaveDraftInput
): Promise<DraftWire | null> {
	const body = await request<{ draft: DraftWire | null }>(
		target,
		`${BASE}/drafts`,
		{ method: "POST", body: input }
	);
	return body?.draft ?? null;
}

export async function deleteDraft(
	target: ApiTarget,
	id: string
): Promise<void> {
	await request(target, `${BASE}/drafts/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

/** Give a draft a condition and queue it. */
export async function armDraft(
	target: ApiTarget,
	id: string,
	trigger: DraftTrigger
): Promise<DraftWire> {
	const body = await request<{ draft: DraftWire }>(
		target,
		`${BASE}/drafts/${encodeURIComponent(id)}/arm`,
		{ method: "POST", body: { trigger } }
	);
	return body.draft;
}

/** Back to an idle draft that sends only by hand. */
export async function disarmDraft(
	target: ApiTarget,
	id: string
): Promise<DraftWire> {
	const body = await request<{ draft: DraftWire }>(
		target,
		`${BASE}/drafts/${encodeURIComponent(id)}/disarm`,
		{ method: "POST" }
	);
	return body.draft;
}

/**
 * Take a draft for sending. Resolves to `null` when another dispatcher already has
 * it (the sidecar answers 409).
 *
 * This is the double-send guard, and it is why the dispatcher must claim BEFORE it
 * sends rather than after: two desktop windows polling the same queue will both see
 * the draft as ready, and exactly one of them wins this call.
 */
export async function claimDraft(
	target: ApiTarget,
	id: string
): Promise<DraftWire | null> {
	try {
		const body = await request<{ draft: DraftWire }>(
			target,
			`${BASE}/drafts/${encodeURIComponent(id)}/claim`,
			{ method: "POST" }
		);
		return body.draft;
	} catch (error) {
		if ((error as { status?: number }).status === 409) {
			return null;
		}
		throw error;
	}
}

/** Report a successful send, with the conversation the message landed in. */
export async function markDraftSent(
	target: ApiTarget,
	id: string,
	conversationId?: string
): Promise<void> {
	await request(target, `${BASE}/drafts/${encodeURIComponent(id)}/sent`, {
		method: "POST",
		body: { conversation_id: conversationId ?? null },
	});
}

/** Report a failed send. The draft comes back visible carrying the reason. */
export async function markDraftFailed(
	target: ApiTarget,
	id: string,
	error: string
): Promise<void> {
	await request(target, `${BASE}/drafts/${encodeURIComponent(id)}/failed`, {
		method: "POST",
		body: { error },
	});
}

export async function saveDraftsSettings(
	target: ApiTarget,
	settings: DraftsSettings
): Promise<DraftsSettings> {
	const body = await request<{ settings: DraftsSettings }>(
		target,
		`${BASE}/settings`,
		{ method: "PUT", body: settings }
	);
	return body.settings;
}
