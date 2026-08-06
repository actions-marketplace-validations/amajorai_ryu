// apps/desktop/src/lib/themes/publish.test.ts
//
// "Share my theme" produces a plugin manifest, because a marketplace theme IS a
// plugin that contributes one. That makes the export a CONTRACT, not a
// convenience: what lands on the clipboard has to be something `ryu publish`
// accepts and Core can then serve back as `contributes.themes`. These tests pin
// the parts that would fail silently — a manifest that installs but shows no
// theme, or an id that collides with another author's.

import { describe, expect, test } from "bun:test";
import type { ThemeVariant } from "./presets.ts";
import { themeManifestJson, themeToPluginManifest } from "./publish.ts";

const MINE: ThemeVariant = {
	id: "custom-dark-my cool theme-1730000000000",
	label: "My Cool Theme",
	mode: "dark",
	preview: { bg: "#111", surface: "#222", primary: "#7c5", text: "#eee" },
	tokens: { "--background": "#111", "--foreground": "#eee" },
};

describe("themeToPluginManifest", () => {
	test("carries the theme as the manifest's only contribution", () => {
		const m = themeToPluginManifest(MINE) as {
			contributes: { themes: ThemeVariant[] };
		};
		expect(m.contributes.themes).toHaveLength(1);
		const [theme] = m.contributes.themes;
		expect(theme.label).toBe("My Cool Theme");
		expect(theme.mode).toBe("dark");
		expect(theme.tokens).toEqual(MINE.tokens);
		expect(theme.preview).toEqual(MINE.preview);
	});

	test("re-keys the theme under the plugin id instead of exporting the local one", () => {
		// The local id embeds the millisecond it was saved. Publishing that would give
		// every re-export a different id — the same theme would install twice and a
		// user's selection would not survive an update.
		const m = themeToPluginManifest(MINE, { scope: "@acme" }) as {
			id: string;
			contributes: { themes: Array<{ id: string }> };
		};
		expect(m.id).toBe("@acme/my-cool-theme-theme");
		expect(m.contributes.themes[0].id).toBe(
			"@acme/my-cool-theme-theme:my-cool-theme"
		);
		expect(m.contributes.themes[0].id).not.toContain("1730000000000");
	});

	test("is stable across exports of the same theme", () => {
		expect(themeManifestJson(MINE)).toBe(themeManifestJson(MINE));
	});

	test("declares no runnables — a theme ships no code, so it needs no grants", () => {
		const m = themeToPluginManifest(MINE) as { runnables: unknown[] };
		expect(m.runnables).toEqual([]);
	});

	test("lands on the Themes shelf so it is browsable as one", () => {
		const m = themeToPluginManifest(MINE) as { category: string };
		expect(m.category).toBe("Themes");
	});

	test("slugifies a label that is not URL- or scope-safe", () => {
		const m = themeToPluginManifest(
			{ ...MINE, label: "  Ünïcode & Spaces!!  " },
			{ scope: "@acme" }
		) as { id: string };
		expect(m.id).toBe("@acme/unicode-spaces-theme");
	});

	test("folds accents to their base letter rather than dropping them", () => {
		// A plain [^a-z0-9] pass turns "Café Noir" into `caf-noir`, which reads as a
		// typo in the published listing's URL.
		const m = themeToPluginManifest(
			{ ...MINE, label: "Café Noir" },
			{ scope: "@acme" }
		) as { id: string };
		expect(m.id).toBe("@acme/cafe-noir-theme");
	});

	test("a label with no usable characters still yields a valid id", () => {
		const m = themeToPluginManifest({ ...MINE, label: "!!!" }) as {
			id: string;
		};
		expect(m.id).toBe("@you/theme-theme");
	});

	test("emits parseable JSON ending in a newline", () => {
		const text = themeManifestJson(MINE);
		expect(text.endsWith("\n")).toBe(true);
		expect(() => JSON.parse(text)).not.toThrow();
	});
});
