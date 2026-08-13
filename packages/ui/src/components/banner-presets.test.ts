// The point of these tests is the SEAM, not the pixels.
//
// `banner-presets` exists so the agent-banner picker and the marketplace's
// listing banners offer the same gradients. That only holds while the picker's
// gradient rows ARE the shared `ANIMATED_GRADIENT_PRESETS` rows — the moment a
// ramp is hand-rolled here, the two halves fork silently and nothing else in the
// tree notices. So the first test is a bijection, and the rest guard the two
// behaviours a picker depends on: an unknown stored id must not reach a
// renderer, and the colour control must actually recolour.

import { describe, expect, test } from "bun:test";
import {
	BANNER_COLORS,
	BANNER_PRESETS,
	bannerColorHue,
	bannerGradientCss,
	bannerPresetById,
	DITHER_BANNER_PRESET_ID,
	isBannerPresetId,
} from "./banner-presets.ts";
import {
	ANIMATED_GRADIENT_PRESET_NAMES,
	ANIMATED_GRADIENT_PRESETS,
} from "./motion/animated-gradient.tsx";

const gradientPresets = BANNER_PRESETS.filter((p) => p.kind === "gradient");

describe("banner presets", () => {
	test("the gradient rows are exactly the shared animated-gradient presets", () => {
		expect(gradientPresets.map((p) => p.id).sort()).toEqual(
			[...ANIMATED_GRADIENT_PRESET_NAMES].sort()
		);
	});

	test("dither is the first entry and the only non-gradient one", () => {
		expect(BANNER_PRESETS[0]?.id).toBe(DITHER_BANNER_PRESET_ID);
		expect(BANNER_PRESETS.filter((p) => p.kind === "dither")).toHaveLength(1);
	});

	test("every preset has a label", () => {
		for (const preset of BANNER_PRESETS) {
			expect(preset.label.length).toBeGreaterThan(0);
		}
	});

	test("an unknown stored id is rejected rather than painted", () => {
		// The bug this guards: a stale preference reaching a renderer. dither-kit's
		// `fillOf` throws on an unknown palette name, and the same shape one layer
		// up is an editor that crashes on open.
		expect(isBannerPresetId("aurora")).toBe(false);
		expect(bannerPresetById("aurora")).toBeUndefined();
		expect(isBannerPresetId(null)).toBe(false);
		expect(isBannerPresetId(42)).toBe(false);
		for (const preset of BANNER_PRESETS) {
			expect(isBannerPresetId(preset.id)).toBe(true);
		}
	});
});

describe("bannerGradientCss", () => {
	test("returns null for the dither preset, which paints on a canvas", () => {
		const dither = bannerPresetById(DITHER_BANNER_PRESET_ID);
		expect(dither).toBeDefined();
		expect(dither && bannerGradientCss(dither, "purple")).toBeNull();
	});

	test("paints every gradient preset in every palette colour", () => {
		for (const preset of gradientPresets) {
			for (const color of BANNER_COLORS) {
				const css = bannerGradientCss(preset, color);
				expect(css).toContain("linear-gradient(");
				// The two radial pools come from the shared static painter; their
				// presence is what proves this is that painter's output and not a
				// local three-stop ramp.
				expect(css?.match(/radial-gradient\(/g)).toHaveLength(2);
				expect(css).not.toContain("NaN");
				expect(css).not.toContain("undefined");
			}
		}
	});

	test("the colour control actually recolours a gradient preset", () => {
		const preset = gradientPresets[0];
		expect(preset).toBeDefined();
		if (!preset) {
			return;
		}
		const seen = new Set(
			BANNER_COLORS.map((c) => bannerGradientCss(preset, c) ?? "")
		);
		expect(seen.size).toBe(BANNER_COLORS.length);
	});

	test("a custom hue lands on that hue, not the preset's own", () => {
		const preset = gradientPresets[0];
		if (!preset) {
			return;
		}
		// The stop rotation is anchored on the preset's most saturated colour, so
		// asking for hue 200 has to put a stop AT 200 — an off-by-anchor bug shows
		// up here as a ramp that rotated by some other amount.
		const css = bannerGradientCss(preset, 200) ?? "";
		expect(css).toContain("hsl(200 ");
	});

	test("a palette name and its hue paint the same thing", () => {
		const preset = gradientPresets[0];
		if (!preset) {
			return;
		}
		expect(bannerGradientCss(preset, "blue")).toBe(
			bannerGradientCss(preset, bannerColorHue("blue"))
		);
	});

	test("a preset added to the shared table needs no edit here", () => {
		// Not a tautology: it asserts the ADAPTER is derived. If someone replaces
		// the map with a literal list, a table entry with no row here fails this.
		for (const name of Object.keys(ANIMATED_GRADIENT_PRESETS)) {
			expect(BANNER_PRESETS.some((p) => p.id === name)).toBe(true);
		}
	});
});
