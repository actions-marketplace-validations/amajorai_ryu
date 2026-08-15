// The AppIcon tile's theme-preview branch: a theme listing that ships no art of
// its own paints its palette (the same bg/surface/primary bars the Appearance
// tab's preset picker shows) instead of the generative dither avatar. The swatch
// is the theme's identity, and the whole point is that it must NOT be a
// random-hue avatar.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import AppIcon from "./app-icon.tsx";

const THEME_PREVIEW = {
	bg: "#0b0e14",
	surface: "#141926",
	primary: "#7c9cff",
	text: "#e6e9f0",
	mode: "dark",
};

function swatchBarStyles(html: string): string[] {
	// Pull the three inline `background-color`s off the bars (bg fills the rest of
	// the tile; surface/primary are the bottom two bars). React renders the style
	// without a trailing `;`, so stop at the closing quote.
	return [...html.matchAll(/background-color:([^"']+)/g)].map((m) => m[1]);
}

describe("AppIcon theme preview", () => {
	test("paints the theme's palette as the tile when the item ships no art", () => {
		const html = renderToStaticMarkup(
			<AppIcon
				name="Midnight"
				seedId="@acme/midnight"
				themePreview={THEME_PREVIEW}
			/>
		);
		// All three swatch colours are painted as inline backgrounds.
		expect(swatchBarStyles(html)).toEqual(["#0b0e14", "#141926", "#7c9cff"]);
	});

	test("does not paint a dither avatar for a theme with a preview", () => {
		const html = renderToStaticMarkup(
			<AppIcon
				name="Midnight"
				seedId="@acme/midnight"
				themePreview={THEME_PREVIEW}
			/>
		);
		// The generative avatar renders a seeded canvas; the swatch branch must not
		// reach it.
		expect(html).not.toContain("<canvas");
	});

	test("keeps the dither avatar for an art-less non-theme", () => {
		const html = renderToStaticMarkup(
			<AppIcon name="Something" seedId="@acme/x" />
		);
		expect(swatchBarStyles(html)).toEqual([]);
		// The avatar is a seeded canvas, not a colour swatch.
		expect(html).toContain("<canvas");
	});
});
