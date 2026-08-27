import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import RealmsHero from "./realms-hero.tsx";

test("landing page carries the managed startup positioning", () => {
	const html = renderToStaticMarkup(<RealmsHero />);

	expect(html).toContain('data-testid="realms-hero"');
	expect(html).toContain('data-testid="hero-workflow-stage"');
	expect(html).toContain('data-testid="product-realm-selector"');
	expect(html).toContain('data-testid="positioning-section"');
	expect(html).toContain('data-testid="delivery-section"');
	expect(html).toContain('data-testid="toolkit-section"');
	expect(html).toContain('data-testid="start-section"');
	for (const label of [
		"Deploy",
		"SDK",
		"Core",
		"Gateway",
		"Bot",
		"Console",
		"Apps",
	]) {
		expect(html).toContain(label);
	}
	expect(html).toContain("We deploy and run autonomous AI<br/>");
	expect(html).toContain("safely in the");
	expect(html).toContain("cloud");
	expect(html).toContain("background-image:var(--chromatic-gradient)");
	expect(html).not.toContain("Ryu sets up and runs AI");
	expect(html).not.toContain("that works for you in the");
	expect(html).not.toContain("Ryu is AI-native business software.");
	expect(html).not.toContain("Ask Ryu to customise it.");
	expect(html).toContain("After a call");
	expect(html).toContain("Download");
	expect(html).toContain("Documentation");
	expect(html).toContain('aria-label="More download options"');
	expect(html).not.toContain("Explore Ryu Apps");
	expect(html).not.toContain("Book a Demo");
	expect(html).toContain('href="/help"');
	expect(html.indexOf("We deploy and run autonomous AI<br/>")).toBeLessThan(
		html.indexOf('data-testid="hero-workflow-stage"')
	);
	expect(html.indexOf("Download")).toBeLessThan(
		html.indexOf('data-testid="hero-workflow-stage"')
	);
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain("Ryu is an AI deployment platform.");
	expect(html).toContain(
		"Ryu helps pre-seed to seed startups with fewer than 10 employees"
	);
	expect(html).toContain("Customer");
	expect(html).toContain("Time to value");
	expect(html).toContain("Delivery");
	expect(html).toContain(
		"Pre-seed to seed startups with fewer than 10 employees"
	);
	expect(html).toContain("fewer than 10 employees");
	expect(html).toContain("It takes only a few minutes.");
	expect(html).toContain("We deploy and keep it running");
	expect(html).toContain("We provide a simple toolkit.");
	expect(html).toContain("Connect the tools the team already uses.");
	expect(html).toContain(
		"A simple toolkit that connects the tools they already use."
	);
	expect(html).toContain("Run autonomous AI safely in the cloud.");
	expect(html).toContain("AI deployment platform");
	expect(html).toContain("Deploy = Cloud");
	expect(html).toContain("bg-[#dbeafe]");
	expect(html).toContain("bg-[#ede9fe]");
	expect(html).toContain("bg-[#fef3c7]");
	expect(html).toContain("bg-[#ffe0b3]");
	expect(html).toContain("bg-[#ccfbf1]");
	expect(html).toContain("bg-[#fce7f3]");
	expect(html).toContain("bg-[#dcfce7]");
	expect(html).toContain('data-testid="product-realm-tab-deploy"');
	expect(html).toContain('data-testid="product-realm-tab-console"');
	expect(html).toContain('data-testid="toolkit-surface-apps"');
	expect(html).toContain('data-testid="toolkit-surface-bot"');
	expect(html).toContain('data-testid="toolkit-surface-console"');
	expect(html).not.toContain("The product loop");
	expect(html).not.toContain("The managed option");
	expect(html).not.toContain("Keep shipping while Ryu runs the AI layer.");
	expect(html).not.toContain("The pieces that make AI useful on day one.");
	expect(html).not.toContain("Building instead of buying?");
	expect(html).not.toContain("Bring one repetitive job.");
	expect(html).not.toContain("One platform. Every way in.");
	expect(html).not.toContain("$250");
	expect(html).not.toContain("Teams starts at");
	expect(html).not.toContain("See pricing");
	expect(html).not.toContain("Ryu Bot is here");
});
