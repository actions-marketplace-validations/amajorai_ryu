import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BotLanding from "./bot-landing.tsx";
import { BotAppVisual } from "./bot-visual.tsx";

test("Bot landing includes the managed product story", () => {
	const html = renderToStaticMarkup(<BotLanding />);

	expect(html).toContain('data-testid="product-page-bot"');
	expect(html).toContain("data-product-hero-layout=");
	expect(html).toContain("data-product-bento-layout=");
	expect(html).toContain("Ask Ryu Bot to handle a task");
	expect(html).toContain("Ryu Bot");
	expect(html).toContain("Weekly report");
	expect(html).not.toContain("Ryu Bot is here");
});

test("Bot product visual uses theme-aware surfaces", () => {
	const html = renderToStaticMarkup(<BotAppVisual />);

	expect(html).toContain("bg-card");
	expect(html).toContain("bg-muted/60");
	expect(html).toContain("bg-background");
	for (const lightOnlySurface of [
		"bg-[#f1f1ef]",
		"bg-[#e8e8e5]",
		"bg-[#f8f8f6]",
		"bg-[#e7e7e5]",
		"bg-white",
		"border-black/10",
		"ring-black/10",
	]) {
		expect(html).not.toContain(lightOnlySurface);
	}
});
