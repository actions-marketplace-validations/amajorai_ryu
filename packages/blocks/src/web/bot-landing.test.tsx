import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BotLanding from "./bot-landing.tsx";

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
