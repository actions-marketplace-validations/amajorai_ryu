// Turning a locally-saved theme into something publishable.
//
// The marketplace has no `theme` catalog kind on purpose: a theme is an ordinary
// plugin that carries `contributes.themes`, exactly as in VS Code and Zed. So
// "share my theme" is not a bespoke upload path — it is `ryu publish` on a normal
// manifest, and everything a listing gets (versioning, signing, the detail page,
// reviews, the trust scorecard, install/uninstall/enable) comes along unchanged.
//
// This module is the authoring half: it renders a saved `ThemeVariant` into that
// manifest so a user never has to learn the schema to share a palette.

import type { ThemeVariant } from "@/src/lib/themes/presets.ts";

/** The Store shelf theme plugins land on (`STORE_CATEGORY_ORDER` in @ryu/marketplace). */
const THEME_CATEGORY = "Themes";

const COMBINING_MARKS = /\p{M}+/gu;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

/**
 * Lowercase, hyphenated, ASCII — safe as both an npm-style scope tail and a URL
 * segment.
 *
 * Accented letters are folded to their base (NFD, then drop the combining marks)
 * rather than treated as punctuation: "Café Noir" should publish as `cafe-noir`,
 * not `caf-noir`, which is what a plain `[^a-z0-9]` pass produces.
 */
function slugify(label: string): string {
	return (
		label
			.normalize("NFD")
			.replace(COMBINING_MARKS, "")
			.toLowerCase()
			.replace(NON_SLUG_CHARS, "-")
			.replace(EDGE_HYPHENS, "") || "theme"
	);
}

/**
 * A publishable plugin manifest carrying `variant` as its only contribution.
 *
 * The exported theme is re-keyed to `<plugin id>:<slug>` rather than keeping the
 * local `custom-light-…-<timestamp>` id. The local id embeds the moment it was
 * saved, so two people exporting the "same" theme would collide with nothing and
 * agree on nothing; a plugin-scoped id is stable across re-exports and unique
 * across authors by construction — the same reason `hook_events` are namespaced.
 *
 * `runnables` is present and empty deliberately: a theme ships no code at all,
 * which is what makes it the one contribution family that is safe with zero
 * permission grants.
 */
export function themeToPluginManifest(
	variant: ThemeVariant,
	options: { scope?: string } = {}
): Record<string, unknown> {
	const slug = slugify(variant.label);
	const scope = options.scope?.trim() || "@you";
	const pluginId = `${scope}/${slug}-theme`;
	return {
		id: pluginId,
		name: `${variant.label} Theme`,
		version: "1.0.0",
		category: THEME_CATEGORY,
		description: `A ${variant.mode} colour theme for Ryu.`,
		tagline: `${variant.label} — a ${variant.mode} theme`,
		keywords: ["theme", variant.mode, slug],
		engines: { ryu: ">=0.1.0" },
		runnables: [],
		contributes: {
			themes: [
				{
					id: `${pluginId}:${slug}`,
					label: variant.label,
					mode: variant.mode,
					preview: variant.preview,
					tokens: variant.tokens,
				},
			],
		},
	};
}

/** The manifest as the JSON text a user pastes into `manifest.json`. */
export function themeManifestJson(
	variant: ThemeVariant,
	options?: { scope?: string }
): string {
	return `${JSON.stringify(themeToPluginManifest(variant, options), null, 2)}\n`;
}
