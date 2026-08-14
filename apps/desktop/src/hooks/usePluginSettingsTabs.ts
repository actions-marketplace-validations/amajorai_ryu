// apps/desktop/src/hooks/usePluginSettingsTabs.ts
//
// Fetch every enabled plugin's declared settings tabs
// (`GET /api/plugins/contributions`) and expose them parsed + grouped by owning
// plugin id. Shared by the Store's per-plugin "Settings" disclosure (inline on
// the installed card) and the App Settings "Plugins" section (all plugins in one
// place). Uses a plain effect + the active node (no react-query dependency) so it
// works on both surfaces regardless of whether a QueryClient ancestor exists.

import { useCallback, useEffect, useState } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import { getPluginContributions } from "@/src/lib/api/plugins.ts";
import { useCoreRefresh } from "@/src/lib/core-refresh.ts";
import {
	groupTabsByPlugin,
	type PluginSettingsTab,
	parseSettingsTabs,
} from "@/src/lib/pluginSettings.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";

interface PluginSettingsTabsState {
	byPlugin: Map<string, PluginSettingsTab[]>;
	error: boolean;
	loading: boolean;
	reload: () => void;
	tabs: PluginSettingsTab[];
}

export function usePluginSettingsTabs(): PluginSettingsTabsState {
	const [tabs, setTabs] = useState<PluginSettingsTab[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);

	const reload = useCallback(() => setReloadKey((k) => k + 1), []);

	// Auto-recover when Core reconnects or the user hits "Refresh all".
	useCoreRefresh(reload);

	useEffect(() => {
		let cancelled = false;
		const target = toTarget(useNodeStore.getState().getActiveNode());
		setLoading(true);
		setError(false);
		getPluginContributions(target)
			.then((contributions) => {
				if (cancelled) {
					return;
				}
				setTabs(parseSettingsTabs(contributions.settings_tabs));
				setLoading(false);
			})
			.catch(() => {
				if (!cancelled) {
					setError(true);
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
		// `reloadKey` is load-bearing: it is the ONLY thing `reload()` changes, and
		// three callers depend on it (useCoreRefresh above, PluginsSettings, and
		// useScopedSettingsNav). Without it a newly installed plugin's settings tab
		// never appears until the app restarts. A lint autofix emptied this once.
	}, [reloadKey]);

	return { tabs, byPlugin: groupTabsByPlugin(tabs), loading, error, reload };
}
