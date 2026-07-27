// Desktop settings registry.
//
// Every user preference that belongs in a settings tab should register here with
// a category and a `reset` that restores its default. Tab "Reset to defaults"
// and a future desktop-wide reset both call `resetCategory` / `resetAll` — so
// adding a setting means registering it, not updating a hardcoded checklist.
//
// Reset functions must be callable outside React (write storage, notify
// listeners, apply CSS). Local useState mirrors in a settings tab may still
// need a remount or an explicit sync after reset.

/** Settings surface / tab a preference belongs to. */
export type SettingsCategory =
	| "appearance"
	| "shortcuts"
	| "voice"
	| "island"
	| "general"
	| "desktop";

export interface SettingEntry {
	category: SettingsCategory;
	/** Stable id, e.g. `"appearance.sidebar-variant"`. */
	id: string;
	/** Optional human label for diagnostics / future UI. */
	label?: string;
	/** Restore this setting to its default. Must work outside React. */
	reset: () => void;
}

const registry = new Map<string, SettingEntry>();

/** Register (or replace) one setting. Call at module load from the owning file. */
export function registerSetting(entry: SettingEntry): void {
	registry.set(entry.id, entry);
}

/** All registered settings (snapshot). */
export function listSettings(): SettingEntry[] {
	return [...registry.values()];
}

/** Settings in one category. */
export function listSettingsByCategory(
	category: SettingsCategory
): SettingEntry[] {
	return [...registry.values()].filter((e) => e.category === category);
}

/** Restore every setting in a category to its default. */
export function resetCategory(category: SettingsCategory): void {
	for (const entry of registry.values()) {
		if (entry.category === category) {
			entry.reset();
		}
	}
}

/** Restore every registered desktop setting to its default. */
export function resetAllSettings(): void {
	for (const entry of registry.values()) {
		entry.reset();
	}
}
