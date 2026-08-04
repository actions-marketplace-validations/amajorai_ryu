// apps/desktop/src/hooks/useThemePreset.test.ts
//
// Guards the one invariant that made a fresh install unreadable: the theme mode
// has TWO independent resolvers, and they must agree before the user has ever
// picked a mode.
//
//   * next-themes' <ThemeProvider defaultTheme={DEFAULT_THEME_MODE}> puts the
//     `.light`/`.dark` class on <html>, which selects every `dark:` component
//     variant (switch tracks, borders, icon fills).
//   * `initTheme()` here reads the SAME `theme` localStorage key and writes the
//     active preset's colour tokens (--background/--foreground/...) inline.
//
// next-themes only writes `theme` once the user picks a mode, so on a clean
// profile the key is absent and each side falls back to its own default. When
// those defaults differed ("light" vs "system"), a dark-mode OS gave <html
// class="light"> painted with the DARK preset's tokens: dark backgrounds, light
// component variants, dark-on-dark text. It self-healed only after a manual
// toggle, because that finally wrote the key both sides read.
//
// A real DOM (localStorage + documentElement.style) is needed; register
// happy-dom before importing the module under test.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom registers a single global DOM per process; when several test files
// register it in one `bun test` run, the later calls throw "already registered".
// Guard so any file can be run alone or alongside the others.
if (typeof globalThis.window === "undefined") {
	GlobalRegistrator.register();
}

import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_THEME_MODE, defaultThemePrefs } from "@ryu/ui/theme/prefs";
import {
	DEFAULT_DARK_ID,
	DEFAULT_LIGHT_ID,
	findVariant,
} from "@/src/lib/themes/presets.ts";
import { initTheme } from "./useThemePreset.ts";

/** Force the OS preference, which is what "system" (and only "system") reads. */
function stubPrefersDark(prefersDark: boolean) {
	window.matchMedia = ((query: string) => ({
		matches: query.includes("dark") ? prefersDark : false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		addListener: () => undefined,
		removeListener: () => undefined,
		dispatchEvent: () => false,
		onchange: null,
	})) as unknown as typeof window.matchMedia;
}

function appliedBackground(): string {
	return document.documentElement.style.getPropertyValue("--background");
}

function presetBackground(id: string): string {
	const bg = findVariant(id)?.tokens["--background"];
	if (!bg) {
		throw new Error(`preset ${id} has no --background token`);
	}
	return bg;
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute("style");
	stubPrefersDark(false);
});

describe("default theme mode", () => {
	test("the persisted-prefs default matches the constant both resolvers read", () => {
		expect(defaultThemePrefs().mode).toBe(DEFAULT_THEME_MODE);
	});

	test("the default mode is a concrete mode, so it never consults the OS", () => {
		// If this is ever set to "system", the two resolvers can diverge again the
		// moment one of them is mounted with a concrete default.
		expect(DEFAULT_THEME_MODE === "system").toBe(false);
	});
});

describe("initTheme", () => {
	test("a fresh install ignores a dark OS and paints the light preset", () => {
		// The regression: no `theme` key + dark OS used to resolve "system" -> dark
		// while next-themes had already put `.light` on <html>.
		stubPrefersDark(true);
		expect(localStorage.getItem("theme")).toBeNull();

		initTheme();

		expect(appliedBackground()).toBe(presetBackground(DEFAULT_LIGHT_ID));
		expect(appliedBackground()).not.toBe(presetBackground(DEFAULT_DARK_ID));
	});

	test("an explicit dark choice still paints the dark preset", () => {
		localStorage.setItem("theme", "dark");
		stubPrefersDark(false);

		initTheme();

		expect(appliedBackground()).toBe(presetBackground(DEFAULT_DARK_ID));
	});

	test('"system" is still honoured once the user selects it', () => {
		localStorage.setItem("theme", "system");
		stubPrefersDark(true);

		initTheme();

		expect(appliedBackground()).toBe(presetBackground(DEFAULT_DARK_ID));
	});

	test("an unrecognised stored mode falls back to the default, not to the OS", () => {
		localStorage.setItem("theme", "sepia");
		stubPrefersDark(true);

		initTheme();

		expect(appliedBackground()).toBe(presetBackground(DEFAULT_LIGHT_ID));
	});
});
