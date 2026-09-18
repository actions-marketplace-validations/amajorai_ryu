import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductLandingCtas from "./product-landing-ctas.tsx";

test("landing CTAs share the download menu and setup prompt", () => {
	const html = renderToStaticMarkup(<ProductLandingCtas />);

	expect(html).toContain("Download");
	expect(html).not.toContain('data-slot="button-group-separator"');
	expect(html).toContain("border-r-0");
	expect(html).toContain('href="/setup-ryu.md"');
	expect(html).toContain("Set up Ryu for me");
});
