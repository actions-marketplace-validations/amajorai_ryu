// apps/desktop/src/lib/themes/presets.test.ts
//
// The theme picker now draws from THREE pools that used to be one: the shipped
// presets, the user's own saved themes, and themes installed from the marketplace
// (`contributes.themes`). Every regression that matters here is about keeping those
// pools distinguishable after they have been merged for display:
//
//   * the picker's groups are only correct if `getGroupedVariants` never leaks a
//     theme into the wrong pool;
//   * the delete affordance is only safe if `variantSource` refuses to call a
//     built-in or an installed theme "custom" — deleting either is a no-op that
//     looks like data loss;
//   * a selected preset only survives a restart if `findVariant` resolves ids from
//     all three pools, which is the whole reason plugin themes are cached locally.
//
// A real DOM is needed for localStorage; register happy-dom before importing.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom registers a single global DOM per process; when several test files
// register it in one `bun test` run, the later calls throw "already registered".
if (typeof globalThis.window === "undefined") {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_DARK_ID,
	DEFAULT_LIGHT_ID,
	deleteCustomTheme,
	findVariant,
	getAllVariants,
	getGroupedVariants,
	loadPluginThemes,
	STORAGE_KEYS,
	saveCustomTheme,
	savePluginThemes,
	type ThemeVariant,
	variantSource,
} from "./presets.ts";

function variant(id: string, mode: "light" | "dark", label = id): ThemeVariant {
	return {
		id,
		label,
		mode,
		preview: { bg: "#fff", surface: "#eee", primary: "#00f", text: "#000" },
		tokens: { "--background": "#fff", "--foreground": "#000" },
	};
}

beforeEach(() => {
	localStorage.removeItem(STORAGE_KEYS.customThemes);
	localStorage.removeItem(STORAGE_KEYS.pluginThemes);
});

describe("provenance", () => {
	test("a shipped preset is built-in, never deletable", () => {
		expect(variantSource(DEFAULT_LIGHT_ID)).toBe("builtin");
		expect(variantSource(DEFAULT_DARK_ID)).toBe("builtin");
	});

	test("a saved theme is custom", () => {
		saveCustomTheme(variant("custom-light-mine", "light"));
		expect(variantSource("custom-light-mine")).toBe("custom");
	});

	test("an installed theme is 'plugin', NOT custom", () => {
		// The delete button gates on "custom". If an installed theme reported as
		// custom, deleting it would strip it from the custom store it was never in —
		// the theme stays in the picker and the click silently does nothing.
		savePluginThemes([variant("@acme/x:midnight", "dark")]);
		expect(variantSource("@acme/x:midnight")).toBe("plugin");
	});

	test("an unknown id falls back to built-in rather than custom", () => {
		expect(variantSource("nope-does-not-exist")).toBe("builtin");
	});
});

describe("grouping", () => {
	test("splits the three pools and filters by mode", () => {
		saveCustomTheme(variant("custom-light-mine", "light"));
		saveCustomTheme(variant("custom-dark-mine", "dark"));
		savePluginThemes([
			variant("@acme/x:day", "light"),
			variant("@acme/x:night", "dark"),
		]);

		const light = getGroupedVariants("light");
		expect(light.custom.map((v) => v.id)).toEqual(["custom-light-mine"]);
		expect(light.plugin.map((v) => v.id)).toEqual(["@acme/x:day"]);
		expect(light.builtin.every((v) => v.mode === "light")).toBe(true);

		const dark = getGroupedVariants("dark");
		expect(dark.custom.map((v) => v.id)).toEqual(["custom-dark-mine"]);
		expect(dark.plugin.map((v) => v.id)).toEqual(["@acme/x:night"]);
	});

	test("the user's own themes come first in the flat list", () => {
		// The picker shows the user's themes above ~30 built-ins on purpose; the flat
		// list (used by onboarding) must agree with the grouped one.
		saveCustomTheme(variant("custom-light-mine", "light"));
		savePluginThemes([variant("@acme/x:day", "light")]);
		const ids = getAllVariants("light").map((v) => v.id);
		expect(ids[0]).toBe("custom-light-mine");
		expect(ids[1]).toBe("@acme/x:day");
		expect(ids).toContain(DEFAULT_LIGHT_ID);
	});
});

describe("resolution", () => {
	test("resolves ids from all three pools", () => {
		saveCustomTheme(variant("custom-light-mine", "light", "Mine"));
		savePluginThemes([variant("@acme/x:day", "light", "Acme Day")]);
		expect(findVariant(DEFAULT_LIGHT_ID)?.id).toBe(DEFAULT_LIGHT_ID);
		expect(findVariant("custom-light-mine")?.label).toBe("Mine");
		expect(findVariant("@acme/x:day")?.label).toBe("Acme Day");
	});

	test("a deleted theme stops resolving", () => {
		saveCustomTheme(variant("custom-light-mine", "light"));
		deleteCustomTheme("custom-light-mine");
		expect(findVariant("custom-light-mine")).toBeUndefined();
		expect(getGroupedVariants("light").custom).toEqual([]);
	});

	test("deleting a custom theme leaves installed ones untouched", () => {
		saveCustomTheme(variant("custom-light-mine", "light"));
		savePluginThemes([variant("@acme/x:day", "light")]);
		deleteCustomTheme("custom-light-mine");
		expect(loadPluginThemes().map((v) => v.id)).toEqual(["@acme/x:day"]);
	});

	test("a corrupt cache degrades to empty instead of throwing", () => {
		// The cache is written by a newer/older build than the one reading it, and a
		// parse failure here runs during boot — throwing would take the window down.
		localStorage.setItem(STORAGE_KEYS.pluginThemes, "{not json");
		expect(loadPluginThemes()).toEqual([]);
		localStorage.setItem(STORAGE_KEYS.pluginThemes, '{"not":"an array"}');
		expect(loadPluginThemes()).toEqual([]);
	});
});
