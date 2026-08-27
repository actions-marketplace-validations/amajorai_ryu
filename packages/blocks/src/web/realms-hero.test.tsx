import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import RealmsHero from "./realms-hero.tsx";

test("main hero leads with adaptable apps and the unified subscription", () => {
	const html = renderToStaticMarkup(<RealmsHero />);

	expect(html).toContain('data-testid="realms-hero"');
	expect(html).toContain('data-testid="app-creation-visual"');
	expect(html).toContain('data-testid="realm-card-apps"');
	expect(html).toContain('data-testid="realm-card-bot"');
	expect(html).toContain('data-testid="realm-card-console"');
	expect(html).toContain('data-testid="product-realm-selector"');
	for (const label of [
		"Ryu OS",
		"Ryu Bot",
		"Ryu Console",
		"Ryu Gateway",
		"Ryu Box",
		"Ryu Hire",
	]) {
		expect(html).toContain(label);
	}
	expect(html).toContain("Ryu is AI-native business software.");
	expect(html).toContain("Ask Ryu to customise it.");
	expect(html).toContain("Ryu is AI-native business software.<br/>Ask Ryu");
	expect(html).toContain("Build a CRM for our sales team.");
	expect(html).toContain("Book a Demo");
	expect(html.indexOf("Ryu is AI-native business software.")).toBeLessThan(
		html.indexOf('data-testid="app-creation-visual"')
	);
	expect(html.indexOf("Book a Demo")).toBeLessThan(
		html.indexOf('data-testid="app-creation-visual"')
	);
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain("One Ryu subscription");
	expect(html).toContain("$250");
	expect(html).not.toContain("Ryu Apps · one subscription");
	expect(html).not.toContain("Start with a workflow your team already runs.");
	expect(html).not.toContain("Teams starts at");
	expect(html).not.toContain("See pricing");
	expect(html).not.toContain("Ryu Bot is here");
});
