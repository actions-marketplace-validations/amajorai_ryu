import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductLandingCtas from "./product-landing-ctas.tsx";

test("product landing CTAs share the download menu and demo link", () => {
	const html = renderToStaticMarkup(<ProductLandingCtas />);

	expect(html).toContain("Download");
	expect(html).not.toContain('data-slot="button-group-separator"');
	expect(html).toContain("border-r-0");
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain("Request a Demo");
});
