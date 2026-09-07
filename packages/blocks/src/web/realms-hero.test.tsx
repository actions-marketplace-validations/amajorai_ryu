import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCS_URL } from "./data/resources.tsx";
import RealmsHero from "./realms-hero.tsx";

test("homepage preserves the approved headline, download, docs, and interactive workflow", () => {
	const html = renderToStaticMarkup(<RealmsHero />);
	expect(html).toContain("We deploy and run AI agents<br/>");
	expect(html).toContain("safely in the");
	expect(html).toContain("cloud");
	expect(html).toContain(`href="${DOCS_URL}"`);
	expect(html).toContain('aria-label="More download options"');
	expect(html).toContain('data-testid="hero-workflow-stage"');
	expect(html).toContain("After a call");
	expect(html.indexOf("We deploy and run AI agents<br/>")).toBeLessThan(
		html.indexOf('data-testid="hero-workflow-stage"')
	);
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
