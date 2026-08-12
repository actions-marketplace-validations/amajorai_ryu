// apps/desktop/src/lib/timezone.ts
//
// One shared, persisted display time zone for every wall-clock timestamp the
// desktop renders. The stored value is either the sentinel `"system"` (follow
// the machine's zone — the default) or an IANA zone id like `"Europe/London"`.
//
// Everything that shows a date or a clock time should go through the
// formatters here instead of calling `toLocaleDateString` / `toLocaleTimeString`
// directly, so switching the setting moves every surface at once. Relative ages
// (`compactAge` in ./time.ts) are zone-independent and stay as they are — but
// day *bucketing* is not, which is why `startOfTodayMs()` lives here too.
//
// React binding: @/src/hooks/useTimezone.ts.

/** localStorage key holding `"system"` or an IANA zone id. */
export const TIMEZONE_KEY = "ryu:timezone";

/** Default: follow the machine's zone. */
export const DEFAULT_TIMEZONE = "system";

/** The sentinel meaning "whatever the OS says". */
export const SYSTEM_TIMEZONE = "system";

const listeners = new Set<() => void>();

let cached: string | null = null;

/** The stored preference: `"system"` or an IANA zone id. */
export function getTimezonePreference(): string {
	if (cached !== null) {
		return cached;
	}
	try {
		cached = localStorage.getItem(TIMEZONE_KEY) || DEFAULT_TIMEZONE;
	} catch {
		cached = DEFAULT_TIMEZONE;
	}
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
	const onStorage = (e: StorageEvent) => {
		if (e.key === TIMEZONE_KEY) {
			cached = null;
			formatterCache.clear();
			cb();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
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
	formatterCache.clear();
	for (const cb of listeners) {
		cb();
	}
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
	options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
	const timeZone = resolveTimeZone();
	const key = `${timeZone ?? ""}|${JSON.stringify(options)}`;
	const hit = formatterCache.get(key);
	if (hit) {
		return hit;
	}
	// `undefined` locale = the user's locale, matching the `toLocale*String`
	// calls this replaces.
	const made = new Intl.DateTimeFormat(undefined, { ...options, timeZone });
	formatterCache.set(key, made);
	return made;
}

function toDate(value: DateLike): Date | null {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function format(value: DateLike, options: Intl.DateTimeFormatOptions): string {
	const date = toDate(value);
	if (!date) {
		return "";
	}
	try {
		return formatterFor(options).format(date);
	} catch {
		// An unsupported zone id (stale preference, exotic runtime) must never
		// blank a timestamp — fall back to the machine's zone.
		return date.toLocaleString(undefined, options);
	}
}

/** Date only, in the display zone. Drop-in for `toLocaleDateString`. */
export function formatDate(
	value: DateLike,
	options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
): string {
	return format(value, options);
}

/** Clock time only, in the display zone. Drop-in for `toLocaleTimeString`. */
export function formatTime(
	value: DateLike,
	options: Intl.DateTimeFormatOptions = { timeStyle: "medium" }
): string {
	return format(value, options);
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
 * Epoch ms for midnight of "today" **in the display zone**.
 *
 * Day buckets (Today / Yesterday / Last week) are the one place a display zone
 * changes more than the text: a 09:00 Tokyo stamp filed under the machine's
 * midnight would read as "Yesterday". Callers computing buckets must use this
 * rather than `new Date().setHours(0, 0, 0, 0)`.
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

// --- the option list -------------------------------------------------------

export interface TimezoneOption {
	/** `"(GMT+01:00) Europe/London"`. */
	label: string;
	/** Minutes east of UTC, used only to sort the list. */
	offsetMinutes: number;
	/** `"system"` or an IANA zone id — this is what gets persisted. */
	value: string;
}

// Hoisted: building this inside the map would recompile the pattern ~450 times.
const GMT_OFFSET_RE = /GMT([+-])(\d{1,2})(?::(\d{2}))?/;

const MINUTES_IN_HOUR = 60;

/** Enough of a list to keep the picker usable if `supportedValuesOf` is absent. */
const FALLBACK_ZONES = [
	"UTC",
	"America/Los_Angeles",
	"America/New_York",
	"Europe/London",
	"Europe/Berlin",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Australia/Sydney",
];

function supportedZones(): string[] {
	try {
		const values = Intl.supportedValuesOf?.("timeZone");
		return values && values.length > 0 ? [...values] : FALLBACK_ZONES;
	} catch {
		return FALLBACK_ZONES;
	}
}

/** `"GMT+01:00"` for a zone right now, or `"GMT+00:00"` if it can't be read. */
export function zoneOffsetLabel(
	timeZone: string,
	now: Date = new Date()
): string {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			timeZoneName: "shortOffset",
		}).formatToParts(now);
		const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
		const match = GMT_OFFSET_RE.exec(raw);
		if (!match) {
			// A bare "GMT" means exactly UTC.
			return "GMT+00:00";
		}
		const hours = match[2].padStart(2, "0");
		const minutes = match[3] ?? "00";
		return `GMT${match[1]}${hours}:${minutes}`;
	} catch {
		return "GMT+00:00";
	}
}

function offsetMinutesOf(label: string): number {
	const match = GMT_OFFSET_RE.exec(label);
	if (!match) {
		return 0;
	}
	const sign = match[1] === "-" ? -1 : 1;
	const hours = Number.parseInt(match[2], 10) || 0;
	const minutes = Number.parseInt(match[3] ?? "0", 10) || 0;
	return sign * (hours * MINUTES_IN_HOUR + minutes);
}

/**
 * Every selectable zone, offset-labelled and sorted west-to-east, with
 * "System" pinned first.
 */
function buildTimezoneOptions(at: number): TimezoneOption[] {
	const now = new Date(at);
	const zones = supportedZones()
		.map((zone) => {
			const offset = zoneOffsetLabel(zone, now);
			return {
				value: zone,
				label: `(${offset}) ${zone.replace(/_/g, " ")}`,
				offsetMinutes: offsetMinutesOf(offset),
			};
		})
		.sort(
			(a, b) =>
				a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value)
		);

	return [
		{
			value: SYSTEM_TIMEZONE,
			label: `System (${systemTimeZone().replace(/_/g, " ")})`,
			offsetMinutes: Number.NEGATIVE_INFINITY,
		},
		...zones,
	];
}

const MS_PER_DAY = 86_400_000;

let optionsCache: TimezoneOption[] | null = null;
let optionsBuiltOnDay = -1;

/**
 * The picker's items — ~450 entries built once and reused, never per render.
 *
 * The cache is keyed by the UTC day because the offsets in the labels are not
 * constant: a desktop window left open across a DST transition would otherwise
 * show an hour-old offset for every zone that just shifted. Transitions always
 * land on a day boundary, so a day key catches every zone's, not just the
 * machine's, and still rebuilds at most once a day.
 */
export function timezoneOptions(now: number = Date.now()): TimezoneOption[] {
	const day = Math.floor(now / MS_PER_DAY);
	if (!optionsCache || day !== optionsBuiltOnDay) {
		optionsCache = buildTimezoneOptions(now);
		optionsBuiltOnDay = day;
	}
	return optionsCache;
}

/** The label shown for a stored preference, even if it is no longer supported. */
export function timezoneLabel(value: string): string {
	const hit = timezoneOptions().find((o) => o.value === value);
	return hit ? hit.label : value;
}

/** Reset the display zone to "system". Used by Appearance → Reset to defaults. */
export function resetTimezone(): void {
	setTimezonePreference(DEFAULT_TIMEZONE);
}
