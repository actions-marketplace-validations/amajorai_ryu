// Guards the Store → settings-dialog jump: the section value it computes must be
// one the settings nav would also have built, because both dialogs look the value
// up in their entity map and silently fall back to their default section when it
// misses. A wrong prefix or scope here is a menu item that opens the dialog on
// "General" with no error to explain it, which is why the mapping is asserted
// against the SAME grouping the nav uses rather than against a hardcoded string.

import { describe, expect, test } from "bun:test";
import {
	APP_SECTION_PREFIX,
	isEntitySection,
	PLUGIN_SECTION_PREFIX,
	type PluginSettingsTab,
	resolveSettingsDestination,
	splitScopedTabs,
} from "./pluginSettings.ts";

function tab(
	plugin: string,
	scope: "node" | "user",
	id = `${plugin}.settings`
): PluginSettingsTab {
	return {
		fields: [{ type: "secret", prefKey: "KEY", label: "API key", options: [] }],
		id,
		plugin,
		scope,
		title: "Settings",
	};
}

// Exa is the motivating case: a plain plugin (no companion) whose only tab is
// node-scoped, so its API key lives in the Gateway dialog.
const EXA = "@ryu/exa";
const COMPANION_APP = "com.ryu.learning";
const isApp = (id: string) => id === COMPANION_APP;

describe("resolveSettingsDestination", () => {
	test("a node-scoped plain plugin resolves to the Gateway dialog", () => {
		const destination = resolveSettingsDestination(
			[tab(EXA, "node")],
			isApp,
			EXA
		);
		expect(destination).toEqual({
			dialog: "gateway",
			section: `${PLUGIN_SECTION_PREFIX}${EXA}`,
		});
	});

	test("a user-scoped companion app resolves to App Settings under app:", () => {
		const destination = resolveSettingsDestination(
			[tab(COMPANION_APP, "user")],
			isApp,
			COMPANION_APP
		);
		expect(destination).toEqual({
			dialog: "app",
			section: `${APP_SECTION_PREFIX}${COMPANION_APP}`,
		});
	});

	test("tabs at both scopes resolve to the node one (where the fields land)", () => {
		const destination = resolveSettingsDestination(
			[tab(EXA, "user", "a"), tab(EXA, "node", "b")],
			isApp,
			EXA
		);
		expect(destination?.dialog).toBe("gateway");
	});

	test("a plugin with no tabs resolves to null, so no affordance renders", () => {
		expect(resolveSettingsDestination([tab(EXA, "node")], isApp, "other")).toBe(
			null
		);
		expect(resolveSettingsDestination([], isApp, EXA)).toBe(null);
	});

	test("the section it returns is one the settings nav also builds", () => {
		// The whole point: same tabs, same isApp — the nav's grouping must contain
		// the id under the same header the prefix names, or the dialog lookup misses.
		const tabs = [tab(EXA, "node"), tab(COMPANION_APP, "node")];
		const grouped = splitScopedTabs(tabs, "node", isApp);
		for (const pluginId of [EXA, COMPANION_APP]) {
			const destination = resolveSettingsDestination(tabs, isApp, pluginId);
			expect(destination).not.toBe(null);
			expect(isEntitySection(destination?.section ?? "")).toBe(true);
			const bucket = destination?.section.startsWith(APP_SECTION_PREFIX)
				? grouped.apps
				: grouped.plugins;
			expect(bucket.has(pluginId)).toBe(true);
		}
	});
});
