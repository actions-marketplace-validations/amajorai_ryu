// packages/ui/src/lib/timezone.ts
//
// The CORE of the one shared, persisted display time zone every wall-clock
// timestamp in the product renders through. The stored value is either the
// sentinel `"system"` (follow the machine's zone — the default) or an IANA zone
// id like `"Europe/London"`.
//
// Why this half lives in `@ryu/ui` and not in the desktop app: the chat
// transcript is `@ryu/blocks`, which depends on `@ryu/ui` but NOT on
// `apps/desktop`. Leaving the store there meant the transcript could not reach
// it and kept hardcoding `en-GB` with no `timeZone` — the exact drift this
// module exists to prevent. This is a SPLIT, not a move: the picker-only
// surface (`timezoneOptions`, `zoneOffsetLabel`, `timezoneLabel` and their ~450
// entries) stays in `apps/desktop/src/lib/timezone.ts`, which re-exports
// everything here. There is still exactly one store, one formatter cache and
// one listener set.
//
// Everything that shows a date or a clock time should go through the formatters
// here instead of calling `toLocaleDateString` / `toLocaleTimeString` directly,
// so switching the setting moves every surface at once. Relative ages
// (`compactAge` in the desktop's ./time.ts) are zone-independent and stay as
// they are — but day *bucketing* is not, which is why `startOfTodayMs()` lives
// here too.

import { useSyncExternalStore } from "react";

/** localStorage key holding `"system"` or an IANA zone id. */
export const TIMEZONE_KEY = "ryu:timezone";

/** Host-projected effective IANA zone for null-origin Companion documents. */
export const TIMEZONE_TOKEN = "--ryu-timezone";

/** Host-projected locale used for the same date/time display conventions. */
export const LOCALE_TOKEN = "--ryu-locale";

/** Same-document signal used by preference writers that cannot rely on storage events. */
export const TIMEZONE_CHANGE_EVENT = "ryu:timezone-change";

/** Default: follow the machine's zone. */
export const DEFAULT_TIMEZONE = "system";

/** The sentinel meaning "whatever the OS says". */
export const SYSTEM_TIMEZONE = "system";

const listeners = new Set<() => void>();

let cached: string | null = null;

function storedTimezone(): string | null {
	try {
		return localStorage.getItem(TIMEZONE_KEY);
	} catch {
		return null;
	}
}

function documentToken(name: string): string | null {
	if (typeof document === "undefined") {
		return null;
	}
	try {
		const value = getComputedStyle(document.documentElement)
			.getPropertyValue(name)
			.trim();
		return value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

function hostedTimezone(): string | null {
	const value = documentToken(TIMEZONE_TOKEN);
	return value && value !== SYSTEM_TIMEZONE ? value : null;
}

function embeddedDocument(): boolean {
	return typeof window !== "undefined" && window.parent !== window;
}

function effectiveTimezoneToken(preference: string): string {
	if (preference !== SYSTEM_TIMEZONE) {
		return preference;
	}
	return systemTimeZone();
}

/** Mirror the current effective zone onto the local root for bridge observers. */
function syncDocumentTimezoneToken(preference?: string): void {
	if (typeof document === "undefined") {
		return;
	}
	const value = preference ?? storedTimezone() ?? DEFAULT_TIMEZONE;
	try {
		document.documentElement.style.setProperty(
			TIMEZONE_TOKEN,
			effectiveTimezoneToken(value)
		);
	} catch {
		// DOM projection is best-effort; the local preference remains authoritative.
	}
}

/** The stored preference: `"system"` or an IANA zone id. */
export function getTimezonePreference(): string {
	const stored = storedTimezone();
	const host = hostedTimezone();
	// Desktop keeps the user-facing `"system"` sentinel in its own localStorage,
	// while Island and null-origin frames have no local preference store. Prefer
	// the host projection in those isolated documents without changing Desktop's
	// picker value from `"system"` to the machine's resolved IANA zone.
	if (host && (embeddedDocument() || stored === null)) {
		return host;
	}
	if (cached !== null) {
		return cached;
	}
	cached = stored || DEFAULT_TIMEZONE;
	return cached;
}

/**
 * The zone to hand `Intl`: `undefined` for "system" so the runtime picks, an
 * IANA id otherwise.
 */
export function resolveTimeZone(): string | undefined {
	const pref = getTimezonePreference();
	return pref === SYSTEM_TIMEZONE ? undefined : pref;
}

/** The machine's own zone, e.g. `"Europe/London"`. Falls back to `"UTC"`. */
export function systemTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** The zone timestamps are actually rendered in right now. */
export function effectiveTimeZone(): string {
	return resolveTimeZone() ?? systemTimeZone();
}

/** Subscribe to preference changes (including from a second desktop window). */
export function subscribeTimezone(cb: () => void): () => void {
	listeners.add(cb);
	let last = getTimezonePreference();
	const notifyIfChanged = () => {
		const next = getTimezonePreference();
		if (next === last) {
			return;
		}
		last = next;
		formatterCache.clear();
		cb();
	};
	const onStorage = (e: StorageEvent) => {
		if (e.key === TIMEZONE_KEY) {
			cached = null;
			syncDocumentTimezoneToken(storedTimezone() ?? DEFAULT_TIMEZONE);
			notifyIfChanged();
			window.dispatchEvent(new Event(TIMEZONE_CHANGE_EVENT));
		}
	};
	window.addEventListener("storage", onStorage);
	const observer =
		typeof document !== "undefined" && typeof MutationObserver !== "undefined"
			? new MutationObserver(notifyIfChanged)
			: null;
	observer?.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["style"],
	});
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
		observer?.disconnect();
	};
}

/** Write the display time zone and notify every consumer. */
export function setTimezonePreference(value: string): void {
	cached = value;
	try {
		localStorage.setItem(TIMEZONE_KEY, value);
	} catch {
		// Non-fatal: persistence is best-effort.
	}
	syncDocumentTimezoneToken(value);
	formatterCache.clear();
	for (const cb of listeners) {
		cb();
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event(TIMEZONE_CHANGE_EVENT));
	}
}

/** Reset the display zone to "system". Used by Appearance → Reset to defaults. */
export function resetTimezone(): void {
	setTimezonePreference(DEFAULT_TIMEZONE);
}

// --- React binding ---------------------------------------------------------

/**
 * Subscribe to zone changes without caring what the zone is — for components
 * that only render formatted timestamps and just need to repaint.
 *
 * It is also the dependency to list on any memo whose OUTPUT depends on where
 * midnight falls (day bucketing, date grouping): those recompute a boundary,
 * not just a label, so a subscription alone would leave a stale grouping on
 * screen.
 *
 * Lives beside the store rather than in a hooks file so `@ryu/blocks` can reach
 * it — the transcript needs the revision, and it cannot import `apps/desktop`.
 */
export function useTimezoneRevision(): string {
	return useSyncExternalStore(
		subscribeTimezone,
		getTimezonePreference,
		() => DEFAULT_TIMEZONE
	);
}

// --- formatting ------------------------------------------------------------

export type DateLike = Date | number | string;

/**
 * `Intl.DateTimeFormat` construction is expensive and these formatters run in
 * list renders, so instances are memoized per option-set. The cache is cleared
 * whenever the zone changes.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
	options: Intl.DateTimeFormatOptions,
	timeZone = resolveTimeZone()
): Intl.DateTimeFormat {
	const rawLocale = documentToken(LOCALE_TOKEN);
	const locale = rawLocale && rawLocale !== "system" ? rawLocale : undefined;
	const key = `${locale ?? ""}|${timeZone ?? ""}|${JSON.stringify(options)}`;
	const hit = formatterCache.get(key);
	if (hit) {
		return hit;
	}
	// `undefined` locale = the user's locale, matching the `toLocale*String`
	// calls this replaces.
	const made = new Intl.DateTimeFormat(locale ?? undefined, {
		...options,
		timeZone,
	});
	formatterCache.set(key, made);
	return made;
}

function toDate(value: DateLike): Date | null {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatInZone(
	value: DateLike,
	options: Intl.DateTimeFormatOptions,
	timeZone: string | undefined
): string {
	const date = toDate(value);
	if (!date) {
		return "";
	}
	try {
		return formatterFor(options, timeZone).format(date);
	} catch {
		// An unsupported zone id (stale preference, exotic runtime) must never
		// blank a timestamp — fall back to the machine's zone.
		try {
			return new Intl.DateTimeFormat(undefined, options).format(date);
		} catch {
			return new Intl.DateTimeFormat(undefined).format(date);
		}
	}
}

function format(value: DateLike, options: Intl.DateTimeFormatOptions): string {
	return formatInZone(value, options, resolveTimeZone());
}

/** Date only, in the display zone. Drop-in for `toLocaleDateString`. */
export function formatDate(
	value: DateLike,
	options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
): string {
	// Date-only fields are calendar values, not instants. Anchor them at noon UTC
	// and format in UTC so a display zone cannot move `2026-01-15` to the prior day.
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return formatInZone(`${value}T12:00:00.000Z`, options, "UTC");
	}
	return format(value, options);
}

/** Clock time only, in the display zone. Drop-in for `toLocaleTimeString`. */
export function formatTime(
	value: DateLike,
	options: Intl.DateTimeFormatOptions = { timeStyle: "medium" }
): string {
	return format(value, options);
}

/** Format a clock-hour label with the host locale's 12/24-hour convention. */
export function formatHourLabel(
	hour: number,
	options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
): string {
	const bounded = Math.max(0, Math.min(23, Math.trunc(hour)));
	return formatInZone(new Date(Date.UTC(2000, 0, 1, bounded)), options, "UTC");
}

/** Date + time, in the display zone. Drop-in for `toLocaleString`. */
export function formatDateTime(
	value: DateLike,
	options: Intl.DateTimeFormatOptions = {
		dateStyle: "medium",
		timeStyle: "medium",
	}
): string {
	return format(value, options);
}

// --- day boundaries --------------------------------------------------------

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

const DAY_PARTS_OPTIONS: Intl.DateTimeFormatOptions = {
	hourCycle: "h23",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
};

/**
 * Epoch ms for midnight of the day CONTAINING `at`, **in the display zone**
 * (defaults to now, hence the name).
 *
 * Day buckets (Today / Yesterday / Last week) and the transcript's date
 * separators are the one place a display zone changes more than the text: a
 * 09:00 Tokyo stamp filed under the machine's midnight would read as
 * "Yesterday". Callers computing buckets must use this rather than
 * `new Date().setHours(0, 0, 0, 0)`.
 */
export function startOfTodayMs(now: number = Date.now()): number {
	const timeZone = resolveTimeZone();
	if (!timeZone) {
		const local = new Date(now);
		local.setHours(0, 0, 0, 0);
		return local.getTime();
	}
	try {
		const parts = formatterFor(DAY_PARTS_OPTIONS).formatToParts(new Date(now));
		const read = (type: string) => {
			const raw = parts.find((p) => p.type === type)?.value ?? "0";
			return Number.parseInt(raw, 10) || 0;
		};
		// `h23` should never yield 24, but a runtime that ignores it would push
		// midnight a full day back — clamp instead of trusting it.
		const hour = read("hour") % HOURS_PER_DAY;
		const secondsIntoDay =
			(hour * MINUTES_PER_HOUR + read("minute")) * SECONDS_PER_MINUTE +
			read("second");
		const msIntoDay =
			secondsIntoDay * MS_PER_SECOND +
			(((now % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND);
		return now - msIntoDay;
	} catch {
		const local = new Date(now);
		local.setHours(0, 0, 0, 0);
		return local.getTime();
	}
}
