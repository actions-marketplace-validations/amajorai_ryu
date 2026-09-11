import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Logo } from "./logo.tsx";

describe("Logo outline-muted variant", () => {
	test("renders larger muted one-pixel outlines for the body and eyes", () => {
		const html = renderToStaticMarkup(
			<Logo
				animated={false}
				animation="idle"
				expression="neutral"
				size="64px"
				variant="outline-muted"
			/>
		);
		const rects = [...html.matchAll(/<rect[^>]*>/g)].map(([match]) => match);

		expect(html).toContain("text-muted-foreground");
		expect(html).toContain('data-expressive-animation="idle"');
		expect(html).toContain('data-expressive-eye-scale="1.5"');
		expect(html).toContain('fill="none"');
		expect(html).toContain('stroke-width="1"');
		expect(html).toContain('vector-effect="non-scaling-stroke"');
		expect(html).not.toContain('fill="currentColor"');
		expect(rects).toHaveLength(2);
		for (const rect of rects) {
			expect(rect).toContain('fill="none"');
			expect(rect).toContain('stroke="currentColor"');
			expect(rect).toContain('stroke-width="1"');
		}
		expect(html).toContain('width="6"');
		expect(html).toContain('height="12"');
	});

	test("supports named animations without leaving the outline treatment", () => {
		const html = renderToStaticMarkup(
			<Logo
				animated={false}
				animation="wink"
				expression="neutral"
				size="64px"
				variant="outline-muted"
			/>
		);

		expect(html).toContain('data-expressive-animation="wink"');
		expect(html).not.toContain('fill="currentColor"');
		expect(html.match(/stroke-width="1"/g)).toHaveLength(3);
	});

	test("applies a named expression independently from the animation", () => {
		const html = renderToStaticMarkup(
			<Logo
				animated={false}
				animation="idle"
				expression="surprised"
				size="64px"
				variant="outline-muted"
			/>
		);

		expect(html).toContain('data-expressive-animation="idle"');
		expect(html).toContain('data-expressive-expression="surprised"');
		expect(html).toContain('fill="none"');
		expect(html).not.toContain('fill="currentColor"');
	});
});

describe("Logo dead expression", () => {
	test("renders two crossed eyes on the ghost", () => {
		const html = renderToStaticMarkup(
			<Logo
				animated={false}
				animation="idle"
				expression="dead"
				size="96px"
				variant="expressive"
			/>
		);

		expect(html).toContain('data-expressive-expression="dead"');
		expect(html.match(/data-expressive-eye-shape="x"/g)).toHaveLength(2);
		expect(html.match(/<line /g)).toHaveLength(4);
	});
});

describe("Logo 3d variant", () => {
	test("server fallback preserves responsive sizing without invalid SVG coordinates", () => {
		const html = renderToStaticMarkup(
			<Logo className="brand-logo" size="min(64vw, 420px)" variant="3d" />
		);
		expect(html).toContain("brand-logo");
		expect(html).toContain("min(64vw, 420px)");
		expect(html).toContain("<svg");
		expect(html).not.toContain("NaN");
		expect(html).not.toContain("<canvas");
	});
});

test("default logo keeps its shared palette when one color is overridden", () => {
	const html = renderToStaticMarkup(
		<Logo animated={false} colors={{ c1: "#ff0088" }} variant="default" />
	);
	expect(html).toContain("--c1:#ff0088");
	expect(html).toContain("--c2:oklch(70% 0.20 264)");
	expect(html).toContain("--c3:oklch(78% 0.15 230)");
	expect(html).toContain("--bg:oklch(95% 0.02 264)");
});
