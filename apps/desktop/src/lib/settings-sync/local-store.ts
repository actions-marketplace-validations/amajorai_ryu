// Reading, writing, and — the load-bearing part — NOTICING local settings
// changes.
//
// The desktop writes settings from ~a hundred call sites through plain
// `localStorage.setItem`, and the DOM fires no event for a write made by the
// same document (`storage` only reaches OTHER windows). Chasing every call site
// to add a notification would be a huge diff that the next new setting would
// immediately fall out of.
//
// So this patches `localStorage.setItem` / `removeItem` once, exactly as
// `console-buffer.ts` patches `console`, and reports the writes that touch an
// allowlisted key. One seam, and a setting added later is picked up for free as
// soon as its key is allowlisted.
//
// Timestamps: every synced key carries its own `updatedAt`, because the merge is
// per-key last-writer-wins. Those live in one side map (`ryu:settings-sync-meta`)
// rather than being folded into the values, since the values belong to the
// features that own them and must keep their existing shape.

import { isSyncableKey } from "./keys.ts";

/** Side map of `key -> unix ms of the last local change`. Not itself synced. */
const META_KEY = "ryu:settings-sync-meta";

type MetaMap = Record<string, number>;

function readMeta(): MetaMap {
	try {
		const raw = localStorage.getItem(META_KEY);
		return raw ? (JSON.parse(raw) as MetaMap) : {};
	} catch {
		return {};
	}
}

function writeMeta(meta: MetaMap): void {
	try {
		// Uses the ORIGINAL setter: writing meta must never look like a settings
		// change, or every push would dirty the map it just wrote and loop.
		(originalSetItem ?? localStorage.setItem).call(
			localStorage,
			META_KEY,
			JSON.stringify(meta)
		);
	} catch {
		// Best-effort: a full quota means timestamps degrade, not that sync breaks.
	}
}

/** The whole timestamp map. Used at startup to rebuild the pending set. */
export function allLocalTimestamps(): Record<string, number> {
	return readMeta();
}

/**
 * A synchronously-readable cache of the values that do NOT live in local
 * storage — currently just the keyboard shortcuts, which live in Core's
 * preference store behind an HTTP call.
 *
 * It exists for exactly one caller: the flush that runs while the window is
 * closing. That path cannot await anything — the document is gone before a
 * promise resolves, so the request would never be made at all — and the change a
 * user makes seconds before quitting is the one they notice missing.
 */
const CACHE_KEY = "ryu:settings-sync-value-cache";

export function readCachedValue(key: string): string | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
		return cache[key] ?? null;
	} catch {
		return null;
	}
}

export function writeCachedValue(key: string, value: string | null): void {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
		if (value === null) {
			delete cache[key];
		} else {
			cache[key] = value;
		}
		(originalSetItem ?? localStorage.setItem).call(
			localStorage,
			CACHE_KEY,
			JSON.stringify(cache)
		);
	} catch {
		// Best-effort: a miss degrades the close-time flush, not sync itself.
	}
}

/** Unix ms of the last local change to `key`, or 0 if never recorded. */
export function localTimestamp(key: string): number {
	return readMeta()[key] ?? 0;
}

/** Record that `key` changed locally at `at`. */
export function markLocalChange(key: string, at: number = Date.now()): void {
	const meta = readMeta();
	meta[key] = at;
	writeMeta(meta);
}

/** Current local value of a synced key, or null when unset. */
export function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/**
 * Write a value that came FROM the server.
 *
 * Uses the original setter and stamps the remote timestamp, so applying a remote
 * change does not read back as a fresh local change and bounce straight back up.
 */
export function applyRemote(
	key: string,
	value: string | null,
	updatedAt: number
): void {
	try {
		if (value === null) {
			(originalRemoveItem ?? localStorage.removeItem).call(localStorage, key);
		} else {
			(originalSetItem ?? localStorage.setItem).call(localStorage, key, value);
		}
	} catch {
		return;
	}
	const meta = readMeta();
	meta[key] = updatedAt;
	writeMeta(meta);
}

// ── Change observation ───────────────────────────────────────────────────────

type ChangeListener = (key: string) => void;

const listeners = new Set<ChangeListener>();
let originalSetItem: typeof Storage.prototype.setItem | null = null;
let originalRemoveItem: typeof Storage.prototype.removeItem | null = null;
let installed = false;

function emit(key: string): void {
	if (!isSyncableKey(key)) {
		return;
	}
	markLocalChange(key);
	for (const listener of listeners) {
		listener(key);
	}
}

/**
 * Patch localStorage so writes to allowlisted keys are observable, and pick up
 * writes from sibling windows via the `storage` event. Idempotent.
 *
 * The patch always forwards to the original method first, so a failure in a
 * listener can never stop a setting from being saved.
 */
export function installSettingsObserver(): void {
	if (installed) {
		return;
	}
	installed = true;
	originalSetItem = localStorage.setItem.bind(localStorage);
	originalRemoveItem = localStorage.removeItem.bind(localStorage);

	localStorage.setItem = function patchedSetItem(
		key: string,
		value: string
	): void {
		originalSetItem?.call(localStorage, key, value);
		emit(key);
	};
	localStorage.removeItem = function patchedRemoveItem(key: string): void {
		originalRemoveItem?.call(localStorage, key);
		emit(key);
	};

	// A write from another window of this app. `storage` does not fire in the
	// window that made the change, which is exactly the gap the patch above
	// covers — the two together see every write.
	window.addEventListener("storage", (event) => {
		if (event.key) {
			emit(event.key);
		}
	});
}

/** Subscribe to allowlisted local settings changes. */
export function onSettingsChange(listener: ChangeListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Whether the observer is active (the settings UI reports this). */
export function isSettingsObserverInstalled(): boolean {
	return installed;
}
