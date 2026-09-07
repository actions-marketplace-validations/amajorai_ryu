import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ConsoleLanding from "./build-landing.tsx";

test("Console landing shows the power-user product story", () => {
	const html = renderToStaticMarkup(<ConsoleLanding />);

	expect(html).toContain('data-testid="product-page-console"');
	expect(html).toContain("data-product-hero-layout=");
	expect(html).toContain("data-product-bento-layout=");
	expect(html).toContain("Manage your agents in Ryu Console");
	expect(html).toContain("Review the steps of a run");
	expect(html).toContain("What you can do with Ryu Console");
	expect(html).toContain('data-testid="hero-workflow-stage"');
});
