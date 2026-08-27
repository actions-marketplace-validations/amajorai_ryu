import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductLandingCtas from "./product-landing-ctas.tsx";

test("product landing CTAs share the download menu and demo link", () => {
	const html = renderToStaticMarkup(<ProductLandingCtas />);

	expect(html).toContain("Download");
	expect(html).toContain('href="https://cal.com/amajor/ryu-demo"');
	expect(html).toContain("Request a Demo");
});
