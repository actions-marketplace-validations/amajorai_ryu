import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ConsoleLanding from "./build-landing.tsx";

test("Console landing shows the power-user product story", () => {
	const html = renderToStaticMarkup(<ConsoleLanding />);

	expect(html).toContain('data-testid="console-landing"');
	expect(html).toContain("Your AI, your models, your rules");
	expect(html).toContain("See what happens before you hand it off");
	expect(html).toContain("Make your setup reusable");
	expect(html).toContain('data-testid="hero-workflow-stage"');
});
