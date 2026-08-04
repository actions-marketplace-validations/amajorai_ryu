// apps/desktop/src/hooks/usePluginSettingsOpener.ts
//
// Answers "where is this plugin configured?" for a plugin id, and returns the
// action that takes the user there.
//
// The Store knows a plugin is installed and enabled; it did not know where its
// credentials live. A user who just installed Exa Search had to guess that the
// API-key field sits in the Gateway dialog, under Plugins, under "Exa Search" —
// three hops away from the card they were looking at. This hook is the join that
// removes the guess: the Store's 3-dot menu asks it, and it hands back an opener
// aimed at exactly the tab the settings nav would have shown.
//
// Resolution mirrors `useScopedSettingsNav` EXACTLY, and deliberately reuses its
// primitives (`splitScopedTabs` + the section prefixes) rather than re-deriving
// them. The section value we compute must be one `buildEntityNavGroups` would
// have produced, or the dialog opens, fails its `entityById` lookup, and silently
// falls back to General — a dead menu item with no error to explain it.
//
//   scope "node" → the Gateway (node) dialog        — the manifest default
//   scope "user" → the App Settings dialog
//   app (has a companion) → `app:<id>`;  plain plugin → `plugin:<id>`
//
// A plugin with tabs at both scopes resolves to the node one: that is where the
// default-scope fields (an API key among them) land, so it is the tab the user
// is looking for.

import { useCallback } from "react";
import { useApps } from "@/src/hooks/useApps.ts";
import { usePluginSettingsTabs } from "@/src/hooks/usePluginSettingsTabs.ts";
import { resolveSettingsDestination } from "@/src/lib/pluginSettings.ts";
import { useGatewayDialog } from "@/src/store/useGatewayDialog.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";

/** Resolves a plugin id to an "open its settings" action, or `null` when that
 *  plugin contributes no settings tab (so no affordance should render). */
export type PluginSettingsOpener = (pluginId: string) => (() => void) | null;

/**
 * Build the resolver. Call ONCE per surface (a Store section, the installed
 * list) and pass the returned function down — it reads the contributions feed
 * and the installed-app list, so a call per card would refetch both per row.
 */
export function usePluginSettingsOpener(): PluginSettingsOpener {
	const { tabs } = usePluginSettingsTabs();
	const { apps } = useApps();
	const openGateway = useGatewayDialog((s) => s.openGateway);
	const openSettings = useSettingsDialog((s) => s.openSettings);

	return useCallback(
		(pluginId: string) => {
			// Same predicate the settings nav groups by: an "app" is a plugin that
			// contributes a companion surface, everything else is a plain plugin.
			const isApp = (id: string) =>
				apps.find((a) => a.id === id)?.companion != null;
			const destination = resolveSettingsDestination(tabs, isApp, pluginId);
			if (!destination) {
				// No declared settings — or the plugin is disabled, in which case Core
				// serves no contributions for it and there is nothing to open.
				return null;
			}
			const { dialog, section } = destination;
			return () =>
				dialog === "gateway" ? openGateway(section) : openSettings(section);
		},
		[tabs, apps, openGateway, openSettings]
	);
}
