import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCS_URL } from "./data/resources.tsx";
import RealmsHero from "./realms-hero.tsx";

test("homepage centers a compact hero and places the backed-by marquee beneath it", () => {
	const html = renderToStaticMarkup(<RealmsHero />);
	const heroMarkup = html.slice(0, html.indexOf("</section>"));
	const heroEnd = html.indexOf("</section>");
	const backedByIndex = html.indexOf('data-testid="backed-by-carousel"');
	const productsIndex = html.indexOf('data-testid="product-realm-selector"');

	expect(html).toContain("We deploy and run AI agents<br/>");
	expect(html).toContain("safely in the");
	expect(html).toContain("cloud");
	expect(html).toContain(`href="${DOCS_URL}"`);
	expect(html).toContain('aria-label="More download options"');
	expect(html).not.toContain('data-slot="button-group-separator"');
	expect(html).toContain("border-r-0");
	expect(html).toContain('data-testid="hero-viewport"');
	expect(heroMarkup).toContain("items-center");
	expect(heroMarkup).toContain("text-center");
	expect(heroMarkup).toContain("text-2xl");
	expect(heroMarkup).toContain("md:text-3xl");
	expect(heroMarkup).toContain("h-8");
	expect(heroMarkup).toContain("rounded-full");
	expect(backedByIndex).toBeGreaterThan(heroEnd);
	expect(backedByIndex).toBeLessThan(productsIndex);
	expect(html.match(/data-testid="backed-by-carousel"/g)).toHaveLength(1);
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
	for (const slug of [
		"gateway",
		"passport",
		"connect",
		"box",
		"notify",
		"mail",
		"hire",
	]) {
		expect(html).toContain(`href="/products/${slug}"`);
	}
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain('id="integration-layer"');
	expect(html).toContain('id="managed-deployment"');
});
