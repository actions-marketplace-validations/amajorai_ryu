// The Home dashboard's route used to be a frozen `exact("/home", …)` in
// `builtins.ts` while its sidebar button was already app-registered — so the button
// hid itself when the (default-OFF) Dashboards app was disabled and the route did
// not. These assertions are what stops that path creeping back into shell code: the
// route must come from the app's own declaration, and must vanish with the app.
//
// Pure input/output — no DOM, no registry, no React — mirroring `builtins.test.ts`.

import { describe, expect, it } from "bun:test";
import type { PluginSidebarButton } from "@/src/lib/api/plugins.ts";
import {
	DASHBOARDS_HOME_BUTTON_ID,
	DASHBOARDS_PLUGIN_ID,
} from "@/src/lib/dashboards/app.ts";
import { resolveAppShellPath } from "./app-shell-path.ts";

const button = (
	over: Partial<PluginSidebarButton> = {}
): PluginSidebarButton => ({
	id: DASHBOARDS_HOME_BUTTON_ID,
	plugin: DASHBOARDS_PLUGIN_ID,
	target: "/dashboard",
	title: "Home",
	...over,
});

const home = () =>
	resolveAppShellPath(
		[button()],
		DASHBOARDS_PLUGIN_ID,
		DASHBOARDS_HOME_BUTTON_ID
	);

describe("resolveAppShellPath", () => {
	it("takes the path from the app's declared target", () => {
		expect(home()).toBe("/dashboard");
	});

	it("follows the app when it moves itself", () => {
		// The property the whole change buys: moving the page is a manifest edit, and
		// no shell file names the path.
		expect(
			resolveAppShellPath(
				[button({ target: "/boards" })],
				DASHBOARDS_PLUGIN_ID,
				DASHBOARDS_HOME_BUTTON_ID
			)
		).toBe("/boards");
	});

	it("resolves to nothing when the owning app is disabled", () => {
		// A disabled app contributes no sidebar button at all, so route and affordance
		// disappear together — the disagreement this replaced.
		expect(
			resolveAppShellPath([], DASHBOARDS_PLUGIN_ID, DASHBOARDS_HOME_BUTTON_ID)
		).toBeNull();
	});

	it("matches on (plugin, id), never on the title", () => {
		expect(
			resolveAppShellPath(
				[button({ plugin: "@ryu/imposter" })],
				DASHBOARDS_PLUGIN_ID,
				DASHBOARDS_HOME_BUTTON_ID
			)
		).toBeNull();
		expect(
			resolveAppShellPath(
				[button({ id: "other" })],
				DASHBOARDS_PLUGIN_ID,
				DASHBOARDS_HOME_BUTTON_ID
			)
		).toBeNull();
		// A retitled button still resolves: the id is the join key.
		expect(
			resolveAppShellPath(
				[button({ title: "Boards" })],
				DASHBOARDS_PLUGIN_ID,
				DASHBOARDS_HOME_BUTTON_ID
			)
		).toBe("/dashboard");
	});

	it("strips a query string, since openTab keys tabs on the bare path", () => {
		expect(
			resolveAppShellPath(
				[button({ target: "/dashboard?conversationId=abc" })],
				DASHBOARDS_PLUGIN_ID,
				DASHBOARDS_HOME_BUTTON_ID
			)
		).toBe("/dashboard");
	});

	it("refuses a malformed or root target", () => {
		for (const target of ["", "dashboard", "/"]) {
			expect(
				resolveAppShellPath(
					[button({ target })],
					DASHBOARDS_PLUGIN_ID,
					DASHBOARDS_HOME_BUTTON_ID
				)
			).toBeNull();
		}
	});
});
