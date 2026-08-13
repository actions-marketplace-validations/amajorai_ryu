// Render tests for the detail hero: the ONE icon tile it paints, and the banner
// tiers behind it. Static markup, no DOM — the same idiom as
// apps-catalog-render.test.tsx.
//
// Two regressions are pinned here, and both are invisible to a props-level test.
//
// 1. THE HERO TILE IS A VARIANT, NOT THE CARD TREATMENT. The hero square fixes its
//    glyph white because it sits on the listing's own author-supplied wash rather
//    than a theme surface — and it can only do that because it forces that wash
//    OPAQUE first. Painting the card treatment there (theme-following glyph, wash
//    as declared) loses the glyph on the light end of the standard dissolving
//    ramp every packaged manifest ships. So the assertion is on the resolved
//    classes: hero → `text-white`, card → `text-foreground`, for the SAME spec.
//
// 2. ONE TILE, NOT TWO. The hero used to take its art as an opaque ReactNode and
//    paint its own square around it, so a caller handing it an `<AppIcon>` stacked
//    two tiles — which two Installed-tab heroes shipped. The escape hatch still
//    exists, so the count is asserted rather than assumed.

import { describe, expect, test } from "bun:test";
import { resolveAnimatedGradient } from "@ryu/ui/components/motion/animated-gradient.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import AppIcon from "../chrome/app-icon.tsx";
import DitherBanner from "../chrome/dither-banner.tsx";
import { safeCssBackground } from "../safe-url.ts";
import { ListingHero } from "./listing-detail-shell.tsx";

/** The standard wash every packaged manifest declares: covers the near end of the
 *  square and dissolves to whatever is behind the far end. */
const DISSOLVING = { direction: "down", from: 250, to: "transparent" } as const;

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe("AppIcon — hero vs card treatment", () => {
	test("the card follows the theme over a dissolving wash", () => {
		const html = renderToStaticMarkup(
			<AppIcon dither={DISSOLVING} iconId="bulb" seedId="@ryu/advisor" />
		);
		expect(html).toContain("text-foreground");
		expect(html).not.toContain("text-white");
		expect(html).toContain("rounded-lg");
	});

	test("the hero fixes the glyph white — the card colour there is the bug", () => {
		const html = renderToStaticMarkup(
			<AppIcon
				dither={DISSOLVING}
				iconId="bulb"
				seedId="@ryu/advisor"
				variant="hero"
			/>
		);
		expect(html).toContain("text-white");
		expect(html).not.toContain("text-foreground");
	});

	test("the hero tile is the ring/shadow/rounded-2xl square, not the card one", () => {
		const html = renderToStaticMarkup(
			<AppIcon iconId="bulb" seedId="@ryu/advisor" variant="hero" />
		);
		expect(html).toContain("rounded-2xl");
		expect(html).toContain("ring-white/25");
		expect(html).toContain("shadow-lg");
	});

	test("each variant drops to its own plate when the item declares no wash", () => {
		const card = renderToStaticMarkup(<AppIcon iconId="bulb" />);
		expect(card).toContain("bg-muted");
		const hero = renderToStaticMarkup(<AppIcon iconId="bulb" variant="hero" />);
		// Translucent, so the hero's own band still reads through the square.
		expect(hero).toContain("bg-background/20");
		expect(hero).not.toContain("bg-muted");
	});

	test("a flat iconBackground replaces the plate in both variants", () => {
		for (const variant of ["card", "hero"] as const) {
			const html = renderToStaticMarkup(
				<AppIcon iconBackground="#123456" iconId="bulb" variant={variant} />
			);
			expect(html).toContain("background:#123456");
		}
	});
});

describe("ListingHero — one tile", () => {
	test("renders the listing's art itself from the icon DATA", () => {
		const html = renderToStaticMarkup(
			<ListingHero
				dither={DISSOLVING}
				iconId="bulb"
				iconName="Advisor"
				name="Advisor"
				seedId="@ryu/advisor"
			/>
		);
		expect(occurrences(html, "rounded-2xl")).toBe(1);
		expect(html).toContain("text-white");
	});

	test("the deprecated `icon` node paints INSIDE that tile, not as a second one", () => {
		const html = renderToStaticMarkup(
			<ListingHero
				dither={DISSOLVING}
				icon={<span className="glyph-escape-hatch">E</span>}
				name="Example App"
			/>
		);
		expect(occurrences(html, "rounded-2xl")).toBe(1);
		expect(html).toContain("glyph-escape-hatch");
	});

	test("an item with no art at all still gets its own generative tile", () => {
		const html = renderToStaticMarkup(
			<ListingHero iconName="Advisor" name="Advisor" seedId="@ryu/advisor" />
		);
		expect(occurrences(html, "rounded-2xl")).toBe(1);
		expect(html).toContain("canvas");
	});

	test("the scrim survives — a light banner needs it for the white title", () => {
		const html = renderToStaticMarkup(
			<ListingHero banner={{ background: "#ffffff" }} name="Example App" />
		);
		expect(html).toContain("from-black/75");
	});
});

describe("DitherBanner — an item-declared banner outranks the derived wash", () => {
	test("without a banner the hero derives its wash from icon_dither", () => {
		const html = renderToStaticMarkup(<DitherBanner dither={DISSOLVING} />);
		expect(html).toContain("canvas");
	});

	test("a flat `background` wins over the derived wash", () => {
		const html = renderToStaticMarkup(
			<DitherBanner banner={{ background: "#0099ff" }} dither={DISSOLVING} />
		);
		expect(html).toContain("background:#0099ff");
		expect(html).not.toContain("canvas");
	});

	test("`background` also wins over `colors`, and over the flat fallback", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{ background: "#0099ff", colors: ["#111", "#222"] }}
				fallback="#ff00ff"
			/>
		);
		expect(html).toContain("background:#0099ff");
		expect(html).not.toContain("linear-gradient");
	});

	test("an `imageUrl` paints over the background, and outranks the wash", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{ background: "#0099ff", imageUrl: "https://cdn.test/b.png" }}
				dither={DISSOLVING}
			/>
		);
		expect(html).toContain('src="https://cdn.test/b.png"');
		expect(html).toContain("object-cover");
		expect(html).toContain("background:#0099ff");
		expect(html).not.toContain("canvas");
	});

	test("`colors` still ramp 135° when no `background` is declared", () => {
		const html = renderToStaticMarkup(
			<DitherBanner banner={{ colors: ["#111111", "#222222"] }} />
		);
		expect(html).toContain("linear-gradient(135deg, #111111, #222222)");
	});

	test("`style: dither` keeps its noise overlay", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{ colors: ["#111111"], seed: 7, style: "dither" }}
			/>
		);
		expect(html).toContain("feTurbulence");
	});
});

describe("DitherBanner — the animated gradient degrades to a static paint", () => {
	/** The minimum an author writes: the style token and nothing else. No
	 *  `background`, no `colors`, no `imageUrl` — which is exactly the shape that
	 *  used to fall through to the derived wash. */
	const ANIMATED = { style: "animated-gradient" } as const;

	test("a gradient banner outranks the derived wash", () => {
		// The regression this pins: `explicitBanner` tested only background /
		// imageUrl / colors / dither, so a listing declaring ONLY the new style
		// painted its icon_dither and the gradient never rendered at all.
		const html = renderToStaticMarkup(
			<DitherBanner banner={ANIMATED} dither={DISSOLVING} />
		);
		expect(html).not.toContain("canvas");
		expect(html).toContain("linear-gradient");
	});

	test("without `live` it is a painted div — no canvas, no WebGL context", () => {
		// Cards, grids and list rows never pass `live`, so this IS their rendering.
		const html = renderToStaticMarkup(<DitherBanner banner={ANIMATED} />);
		expect(html).not.toContain("canvas");
		expect(html).toContain("radial-gradient");
	});

	test("`live` still paints the static background under the shader", () => {
		// The floor an evicted or refused context falls back to. It is on the
		// wrapper, so it survives whether or not the canvas ever mounts — and SSR
		// mounts no canvas either way.
		const html = renderToStaticMarkup(<DitherBanner banner={ANIMATED} live />);
		expect(html).toContain("linear-gradient");
		expect(html).not.toContain("canvas");
	});

	test("an unknown preset falls back to prism rather than painting nothing", () => {
		const html = renderToStaticMarkup(
			<DitherBanner banner={{ ...ANIMATED, gradient: { preset: "nope" } }} />
		);
		const prism = renderToStaticMarkup(
			<DitherBanner banner={{ ...ANIMATED, gradient: { preset: "prism" } }} />
		);
		expect(html).toBe(prism);
	});

	test("declared colours reach the static paint", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{
					...ANIMATED,
					gradient: {
						color1: "#111111",
						color2: "#222222",
						color3: "#333333",
					},
				}}
			/>
		);
		expect(html).toContain("#111111");
		expect(html).toContain("#222222");
		expect(html).toContain("#333333");
	});

	test("one fetching colour drops the WHOLE gradient to the derived wash", () => {
		// Same all-or-nothing rule `colors` follows: the three stops are one ramp,
		// and the colours feed a shader uniform as well as a CSS background.
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{
					...ANIMATED,
					gradient: {
						color1: "#111111",
						color2: "url(https://tracker.test/p.png)",
					},
				}}
				dither={DISSOLVING}
			/>
		);
		expect(html).not.toContain("tracker.test");
		expect(html).toContain("canvas");
	});

	test("a hostile number cannot reach a shader uniform unclamped", () => {
		// `swirlIterations: 1e6` is a GPU loop, not an ugly banner. The clamp lives
		// in the resolver both the shader and this paint read, so asserting the
		// resolved value here covers both.
		const resolved = resolveAnimatedGradient({
			config: {
				proportion: Number.POSITIVE_INFINITY,
				scale: 1e9,
				swirlIterations: 1e6,
			},
		});
		expect(resolved.swirlIterations).toBe(20);
		expect(resolved.scale).toBe(4);
		expect(resolved.proportion).toBe(0.35);
	});

	test("noise is the ONE overlay — the gradient reuses the dither texture", () => {
		const html = renderToStaticMarkup(
			<DitherBanner banner={{ ...ANIMATED, noise: { opacity: 50 } }} />
		);
		expect(html).toContain("feTurbulence");
		expect(html).toContain("opacity:0.5");
		// A declared zero means "no grain", not "grain at the default".
		const none = renderToStaticMarkup(
			<DitherBanner banner={{ ...ANIMATED, noise: { opacity: 0 } }} />
		);
		expect(none).not.toContain("feTurbulence");
	});
});

describe("DitherBanner — the untrusted values are guarded before paint", () => {
	test("a non-http(s) imageUrl never reaches an <img>", () => {
		for (const bad of ["javascript:alert(1)", "data:image/svg+xml,<svg/>"]) {
			const html = renderToStaticMarkup(
				<DitherBanner banner={{ imageUrl: bad }} />
			);
			expect(html).not.toContain("<img");
		}
	});

	test("a background that would fetch is dropped to the derived wash", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{ background: "url(https://tracker.test/pixel.png)" }}
				dither={DISSOLVING}
			/>
		);
		expect(html).not.toContain("tracker.test");
		// Dropped, so the item falls back to the tier it would have had anyway.
		expect(html).toContain("canvas");
	});

	test("one fetching stop drops the WHOLE ramp, not just that stop", () => {
		const html = renderToStaticMarkup(
			<DitherBanner
				banner={{ colors: ["#111111", "url(https://tracker.test/p.png)"] }}
			/>
		);
		expect(html).not.toContain("linear-gradient");
		expect(html).not.toContain("tracker.test");
	});
});

describe("safeCssBackground", () => {
	test("passes the colour forms authors actually use", () => {
		for (const ok of [
			"#0099ff",
			"rgb(0 153 255 / 40%)",
			"oklch(0.62 0.19 250)",
			"color-mix(in oklch, #0099ff, black)",
			"var(--brand)",
			"linear-gradient(135deg, #111, #222)",
		]) {
			expect(safeCssBackground(ok)).toBe(ok);
		}
	});

	test("drops every value that would make the browser fetch", () => {
		for (const bad of [
			"url(https://tracker.test/p.png)",
			"URL('https://tracker.test/p.png')",
			"url ( https://tracker.test/p.png )",
			"image-set(https://tracker.test/p.png 1x)",
			"linear-gradient(#111, #222), url(https://tracker.test/p.png)",
			"cross-fade(url(https://tracker.test/p.png), red)",
			"expression(alert(1))",
		]) {
			expect(safeCssBackground(bad)).toBeNull();
		}
	});

	test("treats blank and absent alike", () => {
		expect(safeCssBackground("   ")).toBeNull();
		expect(safeCssBackground(null)).toBeNull();
		expect(safeCssBackground(undefined)).toBeNull();
	});
});
