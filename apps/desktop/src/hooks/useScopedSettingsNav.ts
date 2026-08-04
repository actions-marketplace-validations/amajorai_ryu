// apps/desktop/src/hooks/useScopedSettingsNav.ts
//
// Shared nav model for the two scoped settings dialogs. Both the App Settings
// dialog (user scope) and the Gateway dialog (node scope) render the same two
// dynamic headers — **Apps** and **Plugins** — with one tab per enabled entity
// that declares settings at that scope. This hook is the single place that joins
// the plugin-contributed `settings_tabs` (from `usePluginSettingsTabs`) with the
// installed-app list (from `useApps`, which tells apps apart from plugins via the
// `companion` field) and filters by scope. Each dialog picks the scope it owns
// and renders the resulting `apps` / `plugins` lists identically.

import { useCallback, useMemo } from "react";
import { useApps } from "@/src/hooks/useApps.ts";
import { usePluginSettingsTabs } from "@/src/hooks/usePluginSettingsTabs.ts";
import {
	APP_SECTION_PREFIX,
	PLUGIN_SECTION_PREFIX,
	type PluginSettingsTab,
	type SettingsScope,
	splitScopedTabs,
} from "@/src/lib/pluginSettings.ts";

// The section-value vocabulary lives in the pure lib beside the tab parser (it is
// the same contract, and a resolver there needs it without pulling React in).
// Re-exported here because this hook is where both dialogs already read it from.
export {
	APP_SECTION_PREFIX,
	isEntitySection,
	PLUGIN_SECTION_PREFIX,
} from "@/src/lib/pluginSettings.ts";

/** One entity's nav entry: a stable id, a display label, and its settings tabs. */
export interface ScopedNavEntity {
	id: string;
	label: string;
	tabs: PluginSettingsTab[];
}

export interface ScopedSettingsNav {
	/** Entities that contribute a companion surface (Ryu Apps). */
	apps: ScopedNavEntity[];
	error: boolean;
	loading: boolean;
	/** Plain plugins (no companion). */
	plugins: ScopedNavEntity[];
	reload: () => void;
}

/** A rendered nav group: an optional header + `{value,label}` items. */
export interface EntityNavGroup {
	items: { label: string; value: string }[];
	title: string;
}

/**
 * Build the two dynamic nav groups — **Apps** and **Plugins** — from scoped
 * entities, using the `app:<id>` / `plugin:<id>` section-value convention both
 * dialogs share. A group with no entities is omitted.
 */
export function buildEntityNavGroups(
	apps: ScopedNavEntity[],
	plugins: ScopedNavEntity[]
): EntityNavGroup[] {
	const groups: EntityNavGroup[] = [];
	if (apps.length > 0) {
		groups.push({
			title: "Apps",
			items: apps.map((e) => ({
				value: `${APP_SECTION_PREFIX}${e.id}`,
				label: e.label,
			})),
		});
	}
	if (plugins.length > 0) {
		groups.push({
			title: "Plugins",
			items: plugins.map((e) => ({
				value: `${PLUGIN_SECTION_PREFIX}${e.id}`,
				label: e.label,
			})),
		});
	}
	return groups;
}

/**
 * Build the Apps/Plugins nav for one {@link SettingsScope}. Entities with no tabs
 * at this scope simply don't appear, so a dialog that has neither renders no
 * dynamic headers.
 */
export function useScopedSettingsNav(scope: SettingsScope): ScopedSettingsNav {
	const { tabs, loading, error, reload } = usePluginSettingsTabs();
	const { apps } = useApps();

	// An "app" is a plugin that contributes a companion surface; everything else is
	// a plain plugin. `useApps` is the only place that id → companion map lives.
	const isApp = useCallback(
		(pluginId: string) =>
			apps.find((a) => a.id === pluginId)?.companion != null,
		[apps]
	);
	const nameFor = useCallback(
		(pluginId: string) => apps.find((a) => a.id === pluginId)?.name ?? pluginId,
		[apps]
	);

	return useMemo(() => {
		const split = splitScopedTabs(tabs, scope, isApp);
		const toEntities = (
			m: Map<string, PluginSettingsTab[]>
		): ScopedNavEntity[] =>
			[...m.entries()].map(([id, entityTabs]) => ({
				id,
				label: nameFor(id),
				tabs: entityTabs,
			}));
		return {
			apps: toEntities(split.apps),
			plugins: toEntities(split.plugins),
			loading,
			error,
			reload,
		};
	}, [tabs, scope, isApp, nameFor, loading, error, reload]);
}
