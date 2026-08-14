// apps/desktop/src/components/settings/EntitySettings.tsx
//
// Renders one app/plugin's settings entry (the body shown when its tab under the
// Apps / Plugins header is selected). An app registers its settings through its
// manifest `contributes.settings_tabs`; each tab is EITHER:
//   - declarative `fields` (bound to preference keys) → rendered generically by
//     PluginSettingsFields, no per-app code; or
//   - a `view` — a rich settings UI the app ships. First-party built-in apps
//     resolve it to a desktop component through SETTINGS_VIEWS below (the settings
//     analogue of the route table in `contributions/builtins.ts`). Third-party
//     apps would resolve it to their sandboxed UI (future — see PluginHostPanel);
//     until then a third-party `view` falls back to whatever `fields` it declared.
//
// A `view` only resolves to a first-party component for a BUILT-IN app: a
// third-party app can't borrow the Memory/Meetings component by naming its key.

import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@ryu/ui/components/alert.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { type ComponentType, useState } from "react";
import { useApps } from "@/src/hooks/useApps.ts";
import type { ScopedNavEntity } from "@/src/hooks/useScopedSettingsNav.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import type { PluginSettingsTab } from "@/src/lib/pluginSettings.ts";
import { DictationSettings } from "./DictationSettings.tsx";
import { IslandSettings } from "./IslandSettings.tsx";
import { LearningSettings } from "./LearningSettings.tsx";
import { MeetingsSettings } from "./MeetingsSettings.tsx";
import { MemoryTab } from "./MemoryTab.tsx";
import { PluginSettingsFields } from "./PluginSettingsFields.tsx";
import { PredictSettings } from "./PredictSettings.tsx";
import { QuestsSettings } from "./QuestsSettings.tsx";
import { ShadowSettings } from "./ShadowSettings.tsx";
import { SettingsSection } from "./shared/settings-items.tsx";
import { SpacesSettings } from "./SpacesSettings.tsx";

/**
 * First-party settings views, keyed by the OWNING plugin id. Mirrors the
 * `path → component` table built-in routes use (`contributions/builtins.ts`). A
 * built-in app whose settings are a rich custom UI declares `{"view": "..."}` in
 * its manifest and is bound to its component here by its id.
 *
 * Keying on the plugin **id** (not the opaque `view` string) is the trust gate: a
 * third-party app can declare `"view": "meetings"` but its id isn't a key here, so
 * it can never borrow a first-party component. (`built_in` is NOT usable for this —
 * in Core it flags the 5 sidecar system apps only, not compiled-in first-party
 * apps.) A third-party `view` falls back to its declared `fields`; a sandboxed
 * settings UI for third-party apps can hang off this same seam later.
 */
const SETTINGS_VIEWS: Record<string, ComponentType> = {
	"@ryu/island": IslandSettings,
	"@ryu/learning": LearningSettings,
	"@ryu/meetings": MeetingsSettings,
	"@ryu/memory": MemoryTab,
	"@ryu/quests": QuestsSettings,
	"@ryu/shadow": ShadowSettings,
	"@ryu/spaces": SpacesSettings,
	dictation: DictationSettings,
	predict: PredictSettings,
};

/** Resolve a tab's first-party settings component (bound to its owning plugin id). */
function firstPartyView(tab: PluginSettingsTab): ComponentType | null {
	if (!tab.view) {
		return null;
	}
	return SETTINGS_VIEWS[tab.plugin] ?? null;
}

/**
 * Banner shown when the owning app is installed but not enabled.
 *
 * Its settings are still editable — they are ordinary preferences, written
 * through the generic KV store, and configuring a plugin is usually what makes it
 * worth enabling (an API key being the standard case). What the user must not
 * conclude is that the plugin is running, so the state is stated outright and the
 * one action that changes it sits right here rather than back in the Store.
 */
function DisabledNotice({ entity }: { entity: ScopedNavEntity }) {
	const { toggle } = useApps();
	const [enabling, setEnabling] = useState(false);

	const enable = () => {
		setEnabling(true);
		toggle(entity.id, true)
			.catch(() => {
				// Failures surface through the shared apps-toggle banner; the tab
				// simply stays in its disabled state.
			})
			.finally(() => setEnabling(false));
	};

	return (
		<Alert>
			<AlertTitle>{entity.label} is turned off</AlertTitle>
			<AlertDescription>
				You can set it up now. What you save here is kept and takes effect as
				soon as you turn it on.
			</AlertDescription>
			<AlertAction>
				<Button disabled={enabling} onClick={enable} size="sm">
					{enabling ? "Turning on…" : "Turn on"}
				</Button>
			</AlertAction>
		</Alert>
	);
}

export function EntitySettings({
	entity,
	target,
}: {
	entity: ScopedNavEntity;
	target: ApiTarget;
}) {
	// Declarative-field tabs render together through the generic renderer; view
	// tabs each render their resolved component. Most apps have exactly one tab.
	const fieldTabs = entity.tabs.filter(
		(t) => !firstPartyView(t) && t.fields.length > 0
	);
	// A rich `view` is a live control panel for a RUNNING app — it reads routes
	// behind that app's own enabled gate, so rendering it for a disabled app would
	// produce a spinner that resolves into an error. Declarative fields have no
	// such dependency (they are preference reads/writes), so they still render and
	// the view is replaced by the notice until the app is on.
	const viewTabs = entity.enabled
		? entity.tabs.filter((t) => firstPartyView(t))
		: [];

	return (
		<div className="space-y-4">
			{entity.enabled ? null : <DisabledNotice entity={entity} />}
			{viewTabs.map((tab) => {
				const View = firstPartyView(tab);
				if (!View) {
					return null;
				}
				return entity.tabs.length === 1 ? (
					<View key={tab.id} />
				) : (
					<SettingsSection key={tab.id} title={tab.title}>
						<View />
					</SettingsSection>
				);
			})}
			{fieldTabs.length > 0 ? (
				<PluginSettingsFields
					hideTabTitles={entity.tabs.length === 1}
					tabs={fieldTabs}
					target={target}
				/>
			) : null}
		</div>
	);
}
