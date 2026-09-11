import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCS_URL } from "./data/resources.tsx";
import RealmsHero from "./realms-hero.tsx";

test("homepage preserves the approved headline and uses the full-viewport hero window", () => {
	const html = renderToStaticMarkup(<RealmsHero />);
	const heroMarkup = html.slice(0, html.indexOf("</section>"));
	expect(html).toContain("We deploy and run AI agents<br/>");
	expect(html).toContain("safely in the");
	expect(html).toContain("cloud");
	expect(html).toContain(`href="${DOCS_URL}"`);
	expect(html).toContain('aria-label="More download options"');
	expect(html).not.toContain('data-slot="button-group-separator"');
	expect(html).toContain("border-r-0");
	expect(html).toContain('data-testid="hero-viewport"');
	expect(html).toContain("min-h-svh");
	expect(html).not.toContain("/background.png");
	expect(html).toContain('data-testid="product-bento-grid"');
	expect(heroMarkup).not.toContain('data-testid="hero-workflow-stage"');
	expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
});

test("homepage keeps one link to each surface and standalone service", () => {
	const html = renderToStaticMarkup(<RealmsHero />);
	for (const id of ["apps", "bot", "console"]) {
		expect(
			html.match(new RegExp(`data-testid="realm-card-${id}"`, "g"))
		).toHaveLength(1);
	}
	for (const slug of ["gateway", "box", "notify", "mail", "hire"]) {
		expect(html).toContain(`href="/products/${slug}"`);
	}
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain('id="integration-layer"');
	expect(html).toContain('id="managed-deployment"');
});
