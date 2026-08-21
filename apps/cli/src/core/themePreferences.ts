import type { Theme } from "@/components/ui/theme-provider.tsx";
import {
	RYU_THEME_PRESETS,
	type RyuThemePreset,
	ryuTheme,
	THEME_CATALOG,
	THEME_PRESET_IDS,
	type ThemePresetId,
} from "../ui/theme.ts";

export type { RyuThemePreset, ThemePresetId } from "../ui/theme.ts";
export { RYU_THEME_PRESETS, ryuTheme, THEME_CATALOG, THEME_PRESET_IDS };

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_COLOR_SCHEMES = ["light", "dark"] as const;
export type ThemeColorScheme = (typeof THEME_COLOR_SCHEMES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_THEME_PRESET: ThemePresetId = "ryu";
export const DEFAULT_SYSTEM_COLOR_SCHEME: ThemeColorScheme = "dark";

export interface ThemePreference {
	mode: ThemeMode;
	preset: ThemePresetId;
}

export type ThemePreferences = ThemePreference;

export const DEFAULT_THEME_PREFERENCE: Readonly<ThemePreference> =
	Object.freeze({
		mode: DEFAULT_THEME_MODE,
		preset: DEFAULT_THEME_PRESET,
	});

export const DEFAULT_THEME_PREFERENCES = DEFAULT_THEME_PREFERENCE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function isThemeMode(value: unknown): value is ThemeMode {
	return value === "system" || value === "light" || value === "dark";
}

export function isThemeColorScheme(value: unknown): value is ThemeColorScheme {
	return value === "light" || value === "dark";
}

export function isThemePresetId(value: unknown): value is ThemePresetId {
	return (
		typeof value === "string" &&
		THEME_PRESET_IDS.includes(value as ThemePresetId)
	);
}

export function isThemePreference(value: unknown): value is ThemePreference {
	return (
		isRecord(value) && isThemeMode(value.mode) && isThemePresetId(value.preset)
	);
}

function parsePersistedPreference(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

export function defaultThemePreference(): ThemePreference {
	return {
		mode: DEFAULT_THEME_PREFERENCE.mode,
		preset: DEFAULT_THEME_PREFERENCE.preset,
	};
}

/**
 * Read a persisted preference value without touching storage.
 *
 * Both an already-parsed object and a JSON string are accepted because the
 * eventual CLI config adapter may use either representation. Each field is
 * validated independently so one bad value cannot make the terminal choose an
 * unreadable theme.
 */
export function loadThemePreference(value: unknown): ThemePreference {
	const raw = parsePersistedPreference(value);
	if (!isRecord(raw)) {
		return defaultThemePreference();
	}

	return {
		mode: isThemeMode(raw.mode) ? raw.mode : DEFAULT_THEME_MODE,
		preset: isThemePresetId(raw.preset) ? raw.preset : DEFAULT_THEME_PRESET,
	};
}

/** Plural spelling for callers that treat the pair as a preferences record. */
export function loadThemePreferences(value: unknown): ThemePreferences {
	return loadThemePreference(value);
}

/**
 * Return a fresh, validated object ready for a config adapter to persist.
 * This function intentionally performs no I/O; invalid input is replaced with
 * the same safe defaults used while loading.
 */
export function saveThemePreference(value: unknown): ThemePreference {
	return loadThemePreference(value);
}

export function saveThemePreferences(value: unknown): ThemePreferences {
	return saveThemePreference(value);
}

export function serializeThemePreference(value: unknown): string {
	return JSON.stringify(saveThemePreference(value));
}

export function resolveThemePreference(
	value: unknown,
	systemColorScheme: unknown = DEFAULT_SYSTEM_COLOR_SCHEME
): Theme {
	const preference = loadThemePreference(value);
	const colorScheme: ThemeColorScheme =
		preference.mode === "system"
			? isThemeColorScheme(systemColorScheme)
				? systemColorScheme
				: DEFAULT_SYSTEM_COLOR_SCHEME
			: preference.mode;
	const preset: RyuThemePreset | undefined = THEME_CATALOG[preference.preset];

	return preset?.[colorScheme] ?? THEME_CATALOG.ryu.dark ?? ryuTheme;
}

export function resolveTheme(
	value: unknown,
	systemColorScheme: unknown = DEFAULT_SYSTEM_COLOR_SCHEME
): Theme {
	return resolveThemePreference(value, systemColorScheme);
}
