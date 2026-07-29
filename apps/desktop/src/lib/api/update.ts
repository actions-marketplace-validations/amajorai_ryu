// apps/desktop/src/lib/api/update.ts
//
// Typed client for Core's unified update service (`/api/version`,
// `/api/update/check`). Core is the single source of truth for the update
// *verdict* and the shared *auto-update toggle* (stored in the cross-surface
// preferences KV, so the same setting governs every surface). The actual
// install on desktop is performed by tauri-plugin-updater — but whether to
// surface the toast, and whether to auto-install, is decided from Core's verdict
// + this setting, so all surfaces stay consistent.

import { getReleaseChannel } from "../release-channel.ts";
import { type ApiTarget, request } from "./client.ts";
import { getPreference, setPreference } from "./preferences.ts";

/** Matches Core's `update::ComponentVersion`. */
export interface ComponentVersion {
	name: string;
	version: string;
}

/** Matches Core's `update::VersionInfo` (`GET /api/version`). */
export interface VersionInfo {
	components: ComponentVersion[];
	platform: string;
	ryu_version: string;
}

/** Matches Core's `update::ReleaseAsset`. */
export interface ReleaseAsset {
	kind: string;
	name: string;
	size: number;
	url: string;
}

/** Matches Core's `update::UpdateCheck` (`GET /api/update/check`). */
export interface UpdateCheck {
	asset: ReleaseAsset | null;
	/**
	 * The release channel the verdict was computed on. Defaults to the channel the
	 * running build is on (derived from its own version), overridden by the user's
	 * channel picker. Comparisons are scoped WITHIN this channel — moving between
	 * channels is a channel switch, not an update.
	 */
	channel: string;
	current: string;
	/**
	 * Set when Core's check itself failed (network/API error, GitHub rate
	 * limit). Core fails open — 200 with `update_available: false` and
	 * `latest` echoing `current` — so without reading this field a failed
	 * check is indistinguishable from a genuine "up to date".
	 */
	error?: string | null;
	html_url: string | null;
	latest: string;
	notes: string | null;
	update_available: boolean;
}

/** True when the verdict reports a FAILED check rather than a real "no update". */
export function updateCheckFailed(verdict: UpdateCheck): boolean {
	return (
		Boolean(verdict.error) || !(verdict.update_available || verdict.latest)
	);
}

/** Read the installed Ryu version + per-component builds. */
export function getVersionInfo(target: ApiTarget): Promise<VersionInfo> {
	return request<VersionInfo>(target, "/api/version");
}

/**
 * Ask Core whether an update is available. Fails soft: on any error returns a
 * "no update" verdict so a flaky check never blocks the UI.
 */
export async function checkForUpdate(target: ApiTarget): Promise<UpdateCheck> {
	// Ask Core about the channel the USER picked, not just the one this build
	// happens to be on — otherwise a user who switches to nightly keeps getting the
	// stable verdict and the picker looks broken. Core defaults to the running
	// build's own channel when the parameter is absent.
	const channel = getReleaseChannel();
	try {
		return await request<UpdateCheck>(
			target,
			`/api/update/check?channel=${encodeURIComponent(channel)}`
		);
	} catch {
		return {
			current: "",
			latest: "",
			channel,
			update_available: false,
			notes: null,
			html_url: null,
			asset: null,
		};
	}
}

/** Matches Core's `update::apply::ApplyResult` (`POST /api/update/apply`). */
export interface ApplyUpdateResult {
	/** The new binary was swapped into place. */
	applied: boolean;
	/** Human-readable next step. */
	message: string;
	/** A further step is needed — run an installer, or restart to pick it up. */
	restart_required: boolean;
	/** Absolute path of the staged artifact on the node. */
	staged_path: string;
}

/**
 * Ask the NODE to download + install the release itself (`POST
 * /api/update/apply`).
 *
 * This is the right path for a node the desktop does not own — a cloud/remote
 * Core, where the desktop's native Tauri updater would replace the LOCAL app
 * bundle and leave the remote node on its old build. For a local node the
 * bundled updater is correct instead: Core, Gateway and the CLI ship inside the
 * desktop bundle and move as one.
 */
export function applyNodeUpdate(
	target: ApiTarget,
	asset: ReleaseAsset
): Promise<ApplyUpdateResult> {
	// `request` serializes the body itself — pass the asset, not a JSON string.
	return request<ApplyUpdateResult>(target, "/api/update/apply", {
		method: "POST",
		body: asset,
	});
}

// --- Forced updates (build-time policy) -------------------------------------
//
// While true, the desktop installs an available update on every launch,
// IGNORING the user's auto-update toggle. This is deliberate: Ryu is free during
// the beta (see `betaFree` in @ryu/auth/lib/plans), and when it becomes paid the
// switch ships as a release — forced updates guarantee nobody can sit on an old,
// still-free build past that point. The toggle below remains the source of truth
// for *non-forced* behaviour, so flipping this back to false restores user
// control without any other change.
//
// Forcing never hard-blocks the shell: if the signed updater feed is unreachable
// (unsigned/dev builds), the installer degrades to a manual-download toast rather
// than trapping the user — see AutoUpdater.installUpdate.
export const FORCE_AUTO_UPDATE = true;

// --- Auto-update toggle (shared cross-surface via Core preferences) ---------
// Key matches Core's `update::AUTO_UPDATE_PREF_KEY`. Stored as `{ "enabled": bool }`.

export const AUTO_UPDATE_PREF_KEY = "auto-updates";

/** Whether automatic updates are enabled. Defaults to `true` when unset. */
export async function getAutoUpdateEnabled(
	target: ApiTarget
): Promise<boolean> {
	const raw = await getPreference(target, AUTO_UPDATE_PREF_KEY);
	if (!raw) {
		return true;
	}
	try {
		const parsed = JSON.parse(raw) as { enabled?: unknown };
		return parsed.enabled !== false;
	} catch {
		return true;
	}
}

/** Persist the auto-update toggle. Returns success. */
export function setAutoUpdateEnabled(
	target: ApiTarget,
	enabled: boolean
): Promise<boolean> {
	return setPreference(
		target,
		AUTO_UPDATE_PREF_KEY,
		JSON.stringify({ enabled })
	);
}
