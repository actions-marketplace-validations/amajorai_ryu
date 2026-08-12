// The settings-sync engine: what pushes, when it pushes, and what happens when
// two machines disagree.
//
// TIMING. A settings change is a burst, not an event — dragging a slider or
// walking down a list of switches produces dozens of writes in a few seconds.
// So a change starts a debounce timer and every further change RESTARTS it: the
// upload happens once the user stops fiddling, not once per keystroke. Anything
// still pending when the window closes is flushed with a keepalive request,
// because a change made twenty seconds before quitting is exactly the change a
// user would notice missing on the other machine. That flush is SYNCHRONOUS all
// the way down — awaiting anything inside a `pagehide` handler means the request
// is never made at all, which `keepalive` cannot rescue because there is nothing
// to keep alive. The pending set is also rebuilt from disk at startup, so a
// change that never got its debounce (a crash, a force-quit) is still owed and
// still sent.
//
// READING. `EventSource` cannot carry an Authorization header, and this API
// authenticates by bearer, so the live SSE feed the server exposes is not usable
// from here without a token-in-URL scheme that would put a credential in server
// logs. Sync therefore PULLS: on start, when the window regains focus, and on a
// slow background interval. Settings are not chat — a minute of staleness costs
// nothing, and a change you make on the machine you are looking at is applied
// instantly by the feature that owns it, not by sync.
//
// CONFLICTS. The merge is per-key last-writer-wins, and for the ordinary case
// that is the whole story: a key you have not touched since the last sync is
// simply overwritten by a newer remote value. A CONFLICT is narrower and worth a
// prompt — the same key changed on both machines since they last agreed. The
// default policy is to ask, because silently discarding one side is how people
// lose work they cannot see they lost. `download` and `upload` exist for users
// who have decided which machine is authoritative.
//
// SAFETY. Keys are filtered through the allowlist on BOTH directions. A value
// arriving from the server for a key that is not allowlisted here is dropped —
// an older or newer client, or a tampered response, must not be able to write
// arbitrary storage keys on this machine.

import { toTarget } from "@/src/lib/api/client.ts";
import { getKeybindings, setKeybindings } from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	flushSettings,
	pullSettings,
	pushSettings,
	type SyncEntry,
} from "./api.ts";
import {
	currentPlatform,
	isKeybindingsKey,
	isSyncableKey,
	keybindingsKey,
	platformOfKeybindingsKey,
} from "./keys.ts";
import {
	allLocalTimestamps,
	applyRemote,
	installSettingsObserver,
	localTimestamp,
	markLocalChange,
	onSettingsChange,
	readCachedValue,
	readLocal,
	writeCachedValue,
} from "./local-store.ts";

/** How long to wait after the LAST change before uploading. */
export const DEBOUNCE_MS = 60_000;

/** Background pull cadence. Slow on purpose — see the header. */
const POLL_MS = 5 * 60_000;

/** Same-process event `coreKvHotkeyStorage.save` dispatches on every change. */
const KEYBINDINGS_EVENT = "ryu:keybindings-changed";

// ── Persisted engine settings (local to this machine, never synced) ──────────

const ENABLED_KEY = "ryu:settings-sync-enabled";
const POLICY_KEY = "ryu:settings-sync-policy";
const CURSOR_KEY = "ryu:settings-sync-cursor";
const LAST_SYNC_KEY = "ryu:settings-sync-last";

/** What to do when the same setting changed in two places. */
export type ConflictPolicy = "ask" | "download" | "upload";

function readString(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeString(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Best-effort.
	}
}

/** Whether this machine participates in sync. Opt-in: uploading a user's
 *  configuration to the cloud is not something to start doing unasked. */
export function isSyncEnabled(): boolean {
	return readString(ENABLED_KEY) === "true";
}

export function setSyncEnabled(enabled: boolean): void {
	writeString(ENABLED_KEY, enabled ? "true" : "false");
	notify();
	if (enabled) {
		void syncNow();
	}
}

export function getConflictPolicy(): ConflictPolicy {
	const raw = readString(POLICY_KEY);
	return raw === "download" || raw === "upload" ? raw : "ask";
}

export function setConflictPolicy(policy: ConflictPolicy): void {
	writeString(POLICY_KEY, policy);
	notify();
}

/** Server `updatedAt` this machine has already seen. */
function cursor(): number {
	const raw = Number(readString(CURSOR_KEY));
	return Number.isFinite(raw) ? raw : 0;
}

function setCursor(value: number): void {
	writeString(CURSOR_KEY, String(value));
}

/** Unix ms of the last completed sync, or 0. */
export function lastSyncAt(): number {
	const raw = Number(readString(LAST_SYNC_KEY));
	return Number.isFinite(raw) ? raw : 0;
}

// ── Observable engine state ─────────────────────────────────────────────────

export interface SyncConflict {
	key: string;
	/** This machine's value and when it changed. */
	local: string | null;
	localAt: number;
	/** The server's value and when it changed. */
	remote: string | null;
	remoteAt: number;
}

export type SyncStatus = "idle" | "syncing" | "offline" | "conflict";

const listeners = new Set<() => void>();
let revision = 0;
let status: SyncStatus = "idle";
let conflicts: SyncConflict[] = [];
/** Keys changed locally and not yet accepted by the server. */
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
let started = false;
/** True while a sync cycle is running — see `syncNow`. */
let inFlight = false;

function notify(): void {
	revision++;
	for (const listener of listeners) {
		listener();
	}
}

export function subscribeSyncState(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getSyncRevision(): number {
	return revision;
}

export function getSyncStatus(): SyncStatus {
	return status;
}

export function getConflicts(): readonly SyncConflict[] {
	return conflicts;
}

export function getPendingCount(): number {
	return dirty.size;
}

// ── Keybindings (Core preference, per OS) ───────────────────────────────────

function activeTarget() {
	return toTarget(useNodeStore.getState().getActiveNode());
}

/** This machine's shortcut overrides, as a JSON string. Null when unreachable. */
async function readKeybindings(): Promise<string | null> {
	try {
		const overrides = await getKeybindings(activeTarget());
		return JSON.stringify(overrides);
	} catch {
		return null;
	}
}

/**
 * True while a remote shortcut set is being applied. The apply has to dispatch
 * the same change event every other window listens on, and that event is also
 * how this engine learns about LOCAL shortcut edits — without this flag, every
 * download would immediately look like an upload and the two machines would
 * trade the same value forever.
 */
let applyingKeybindings = false;

/**
 * Write shortcut overrides that arrived from another machine of the same OS.
 * Goes through `setKeybindings` rather than touching storage, so Core and every
 * open window get the change through the path they already listen on.
 */
async function writeKeybindings(value: string | null): Promise<void> {
	applyingKeybindings = true;
	try {
		const overrides = value ? JSON.parse(value) : {};
		await setKeybindings(activeTarget(), overrides);
		window.dispatchEvent(
			new CustomEvent(KEYBINDINGS_EVENT, { detail: overrides })
		);
	} catch {
		// A malformed payload must not wipe the user's shortcuts.
	} finally {
		applyingKeybindings = false;
	}
}

// ── Local <-> wire ───────────────────────────────────────────────────────────

/** The wire key for this machine's shortcuts. */
function ownKeybindingsKey(): string {
	return keybindingsKey(currentPlatform());
}

/** Whether a wire key may be written on THIS machine. */
function acceptsKey(key: string): boolean {
	if (isKeybindingsKey(key)) {
		// Only the slot for this OS. A Mac must never apply Windows chords.
		return platformOfKeybindingsKey(key) === currentPlatform();
	}
	return isSyncableKey(key);
}

/**
 * A synced key's current local value, WITHOUT awaiting anything.
 *
 * Every allowlisted key is a plain storage read; the shortcut slot is served
 * from the value cache. This is the only form the close-time flush can use, so
 * it is also the form the normal push uses — one code path, so the flush is not
 * a second, less-tested one.
 */
function readValueSync(key: string): string | null {
	if (isKeybindingsKey(key)) {
		return readCachedValue(key);
	}
	return readLocal(key);
}

/** Refresh the shortcut cache from Core. Safe to call when nothing needs it. */
async function refreshKeybindingsCache(): Promise<void> {
	const key = ownKeybindingsKey();
	if (!dirty.has(key)) {
		return;
	}
	const value = await readKeybindings();
	if (value !== null) {
		writeCachedValue(key, value);
	}
}

/** Apply a remote value locally. */
async function writeValue(
	key: string,
	value: string | null,
	updatedAt: number
): Promise<void> {
	if (isKeybindingsKey(key)) {
		await writeKeybindings(value);
		writeCachedValue(key, value);
		markLocalChange(key, updatedAt);
		return;
	}
	applyRemote(key, value, updatedAt);
}

/** Build the push payload for the dirty set. Synchronous — see `readValueSync`. */
function collectDirty(): SyncEntry[] {
	const entries: SyncEntry[] = [];
	for (const key of dirty) {
		const value = readValueSync(key);
		entries.push({
			key,
			value,
			updatedAt: localTimestamp(key) || Date.now(),
			deleted: value === null,
		});
	}
	return entries;
}

/**
 * Rebuild the pending set from what is on disk.
 *
 * The dirty set is in-memory, so a quit — clean or not — between a change and
 * the debounce firing would otherwise strand that change forever: nothing would
 * push it, and the pull path correctly declines to overwrite it, so it would sit
 * local-only until the user happened to touch the same setting again. The
 * timestamps and the cursor are both persisted, and their difference is exactly
 * the set of changes this machine still owes.
 */
function seedDirtyFromDisk(): void {
	const seen = cursor();
	for (const [key, at] of Object.entries(allLocalTimestamps())) {
		if (at > seen && acceptsKey(key)) {
			dirty.add(key);
		}
	}
}

// ── The sync cycle ───────────────────────────────────────────────────────────

/**
 * Apply one remote entry, or record a conflict.
 *
 * The conflict test is deliberately narrow: a key is only contested when THIS
 * machine has an unpushed change to it AND the values actually differ. A key the
 * user never touched here is not a conflict, it is just news.
 */
async function applyOrConflict(entry: SyncEntry): Promise<boolean> {
	if (!acceptsKey(entry.key)) {
		return false;
	}
	const local = readValueSync(entry.key);
	if (local === (entry.deleted ? null : entry.value)) {
		// Already agrees — adopt the timestamp so it stops looking pending.
		markLocalChange(entry.key, entry.updatedAt);
		dirty.delete(entry.key);
		return false;
	}
	const localAt = localTimestamp(entry.key);
	const contested = dirty.has(entry.key) && localAt > 0;
	if (contested) {
		const policy = getConflictPolicy();
		if (policy === "upload") {
			return false;
		}
		if (policy === "ask") {
			conflicts = [
				...conflicts.filter((c) => c.key !== entry.key),
				{
					key: entry.key,
					local,
					localAt,
					remote: entry.deleted ? null : entry.value,
					remoteAt: entry.updatedAt,
				},
			];
			return true;
		}
		// policy === "download" falls through to apply.
	}
	if (entry.updatedAt <= localAt) {
		// Ours is newer. This holds under `download` too: "always take the cloud
		// copy" means take the NEWER one, not take an older one — a policy that
		// walked a setting backwards in time would be indistinguishable from data
		// loss. The next push carries ours up instead.
		return false;
	}
	await writeValue(
		entry.key,
		entry.deleted ? null : entry.value,
		entry.updatedAt
	);
	dirty.delete(entry.key);
	return false;
}

/** Resolve one conflict the user has decided on. */
export async function resolveConflict(
	key: string,
	choice: "local" | "remote"
): Promise<void> {
	const conflict = conflicts.find((c) => c.key === key);
	if (!conflict) {
		return;
	}
	conflicts = conflicts.filter((c) => c.key !== key);
	if (choice === "remote") {
		await writeValue(key, conflict.remote, conflict.remoteAt);
		dirty.delete(key);
	} else {
		// Keep this machine's value, but stamp it NEWER than the remote so the
		// next push actually wins rather than being rejected again.
		markLocalChange(key, Math.max(Date.now(), conflict.remoteAt + 1));
		dirty.add(key);
	}
	if (conflicts.length === 0) {
		status = "idle";
	}
	notify();
	if (choice === "local") {
		void syncNow();
	}
}

/** Resolve every outstanding conflict the same way. */
export async function resolveAllConflicts(
	choice: "local" | "remote"
): Promise<void> {
	for (const conflict of [...conflicts]) {
		await resolveConflict(conflict.key, choice);
	}
}

/**
 * One full cycle: pull what changed, apply or flag it, then push what this
 * machine owes. Pull first so a push that is about to be rejected as stale is
 * caught as a conflict here rather than as a silent no-op on the server.
 */
export async function syncNow(): Promise<void> {
	// One cycle at a time. Two overlapping cycles both read `dirty` and both
	// push; the second one's `applied` list then clears keys the first had
	// already handled, and a change that arrived in between is dropped.
	if (!isSyncEnabled() || inFlight) {
		return;
	}
	inFlight = true;
	status = "syncing";
	notify();
	try {
		await runSyncCycle();
	} finally {
		inFlight = false;
	}
}

async function runSyncCycle(): Promise<void> {
	const pulled = await pullSettings(cursor());
	if (!pulled) {
		status = "offline";
		notify();
		return;
	}
	let contested = false;
	for (const entry of pulled.entries) {
		contested = (await applyOrConflict(entry)) || contested;
	}
	setCursor(pulled.updatedAt);

	await refreshKeybindingsCache();
	const entries = collectDirty();
	if (entries.length > 0) {
		const pushed = await pushSettings(entries);
		if (pushed) {
			for (const key of pushed.applied) {
				dirty.delete(key);
			}
			setCursor(pushed.updatedAt);
			// Anything the server refused as stale is, by definition, contested:
			// this machine changed it and so did another one.
			for (const rejection of pushed.rejected) {
				contested = (await applyOrConflict(rejection)) || contested;
			}
		} else {
			status = "offline";
			notify();
			return;
		}
	}

	writeString(LAST_SYNC_KEY, String(Date.now()));
	status = contested || conflicts.length > 0 ? "conflict" : "idle";
	notify();
}

/** Restart the debounce. Every new change pushes the upload further out. */
function scheduleUpload(): void {
	if (timer) {
		clearTimeout(timer);
	}
	timer = setTimeout(() => {
		timer = null;
		void syncNow();
	}, DEBOUNCE_MS);
	notify();
}

/** Push whatever is pending right now, without waiting for the debounce. */
export async function syncPendingNow(): Promise<void> {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	await syncNow();
}

/**
 * Start the engine. Idempotent, and safe to call when sync is disabled — the
 * observer still installs (so timestamps stay accurate for the moment sync is
 * turned on) while nothing is uploaded.
 */
export function startSettingsSync(): () => void {
	if (started) {
		return () => undefined;
	}
	started = true;
	installSettingsObserver();
	seedDirtyFromDisk();

	const unsubscribe = onSettingsChange((key) => {
		if (!isSyncEnabled()) {
			return;
		}
		dirty.add(key);
		scheduleUpload();
	});

	const onKeybindings = (event: Event) => {
		if (!isSyncEnabled() || applyingKeybindings) {
			return;
		}
		const key = ownKeybindingsKey();
		// Cache the payload the event already carries, so the close-time flush can
		// read this value without an HTTP round-trip it has no time to make.
		const detail = (event as CustomEvent<unknown>).detail;
		if (detail !== undefined) {
			writeCachedValue(key, JSON.stringify(detail));
		}
		markLocalChange(key);
		dirty.add(key);
		scheduleUpload();
	};
	window.addEventListener(KEYBINDINGS_EVENT, onKeybindings);

	// A change made moments before quitting is the one people notice missing.
	const onHide = () => {
		if (!isSyncEnabled() || dirty.size === 0) {
			return;
		}
		flushSettings(collectDirty());
	};
	window.addEventListener("pagehide", onHide);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			onHide();
		} else {
			void syncNow();
		}
	});

	poller = setInterval(() => void syncNow(), POLL_MS);
	void syncNow();

	return () => {
		started = false;
		unsubscribe();
		window.removeEventListener(KEYBINDINGS_EVENT, onKeybindings);
		window.removeEventListener("pagehide", onHide);
		if (poller) {
			clearInterval(poller);
			poller = null;
		}
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};
}
