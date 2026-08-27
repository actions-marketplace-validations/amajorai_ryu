import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BotLanding from "./bot-landing.tsx";

test("Bot landing includes the managed product story", () => {
	const html = renderToStaticMarkup(<BotLanding />);

	expect(html).toContain('data-testid="bot-landing"');
	expect(html).toContain("Give AI a job, not a setup");
	expect(html).toContain("Ryu Bot");
	expect(html).toContain("Weekly report");
	expect(html).not.toContain("Ryu Bot is here");
});
