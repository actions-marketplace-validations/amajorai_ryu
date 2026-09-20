import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PRODUCT_REALMS } from "./data/product-realms.ts";
import RealmsHero from "./realms-hero.tsx";

test("homepage leads with the compact headline and 3D logo", () => {
	const html = renderToStaticMarkup(<RealmsHero />);

	expect(html).toContain(
		"The simplest way to deploy and run agents in the cloud 24/7"
	);
	expect(html).toContain('href="/setup-ryu.md"');
	expect(html).toContain('href="https://discord.gg/3RxeVyvdjG"');
	expect(html).toContain("Join our Discord");
	expect(html).not.toContain(
		"Ryu Core runs the work. Ryu Gateway governs the calls."
	);
	expect(html).not.toContain(
		"Sessions, memory, tools, and workflows on the node you choose."
	);
	expect(html).not.toContain(
		"Routing, approvals, budgets, and audit around every call."
	);
	expect(html).not.toContain("Ryu gives agents a place to run.");
	expect(html).toContain('aria-label="More download options"');
	expect(html).not.toContain('data-slot="button-group-separator"');
	expect(html).toContain("border-r-0");
	expect(html).toContain('data-testid="hero-viewport"');
	expect(html).toContain('data-testid="hero-surface"');
	expect(html).toContain("max-w-4xl");
	expect(html).toContain('data-testid="hero-3d-logo"');
	expect(html).toContain("min(70vw, 380px)");
	expect(html).not.toContain('data-testid="hero-runtime-preview"');
	expect(html).toContain('data-testid="backed-by-carousel"');
	expect(html).toContain('data-testid="product-paths"');
	expect(html).toContain('data-testid="product-bento-grid"');
	expect(html).toContain('data-testid="product-demo-connect"');
	expect(html).toContain('data-testid="product-demo-gateway"');
	expect(html).toContain('data-testid="product-demo-compute"');
	expect(html).toContain('data-testid="realm-visual-os"');
	expect(html).toContain('data-testid="realm-visual-apps"');
	expect(html).not.toContain("bg-muted/30 text-foreground");
	expect(html).toContain("max-w-7xl");
	expect(html).toContain(
		"bg-gradient-to-t from-card via-card/95 to-transparent"
	);
	expect(html).toContain("showcase-loop");
	expect(html).toContain("animate-glow-breathe");
	expect(html).toContain("animate-vec-orbit");
	expect(html).not.toContain('data-testid="standalone-services"');
	expect(html).not.toContain("Choose the Ryu path that fits the work");
	expect(html).not.toContain("Use Ryu");
	expect(html).not.toContain("Build with Ryu");
	expect(html).not.toContain("Choose how you want to start");
	expect(html).not.toContain('id="integration-layer"');
	expect(html).not.toContain('id="managed-deployment"');
	expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
	expect(html.indexOf('data-testid="hero-viewport"')).toBeLessThan(
		html.indexOf('data-testid="backed-by-carousel"')
	);
	expect(html.indexOf('data-testid="backed-by-carousel"')).toBeLessThan(
		html.indexOf('data-testid="product-paths"')
	);

	const productStart = html.indexOf('data-testid="product-paths"');
	const productEnd = html.indexOf("</section>", productStart);
	const productMarkup = html.slice(productStart, productEnd);
	expect(productMarkup).not.toContain("<h2");
	expect(productMarkup).not.toContain("<h3");
});

test("homepage keeps every product destination inside one unified grid", () => {
	const html = renderToStaticMarkup(<RealmsHero />);

	for (const product of PRODUCT_REALMS) {
		expect(
			html.match(new RegExp(`data-testid="realm-card-${product.id}"`, "g"))
		).toHaveLength(1);
		expect(html).toContain(`href="${product.href}"`);
	}

	expect(html).toContain('data-testid="realm-card-apps"');
	expect(html).toContain('href="/products/apps"');
	expect(html).toContain('data-testid="tool-access-preview"');
	expect(html).toContain('data-testid="gateway-request-preview"');
	expect(html).toContain('data-testid="deployment-preview"');
});
