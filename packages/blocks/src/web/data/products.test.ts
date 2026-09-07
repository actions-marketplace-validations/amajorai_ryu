import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductLandingPage from "../product-landing-page.tsx";
import { getProduct, products } from "./products.tsx";

test("the standalone product set includes the direct service APIs", () => {
	expect(
		products
			.filter((product) => product.standalone)
			.map((product) => product.slug)
	).toEqual(["gateway", "box", "notify", "mail", "hire"]);
	expect(getProduct("notify")).toMatchObject({
		name: "Ryu Notify",
		standalone: true,
	});
	expect(getProduct("mail")).toMatchObject({
		name: "Ryu Mail",
		standalone: true,
	});
	expect(getProduct("hire")).toMatchObject({
		name: "Ryu Hire",
		standalone: true,
	});
});

test("every public product renders its content through the shared page", () => {
	for (const product of products) {
		const html = renderToStaticMarkup(
			createElement(ProductLandingPage, { product })
		);
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
		expect(html).toContain(product.hero.title);
		expect(html).toContain(`data-testid="product-page-${product.slug}"`);
		expect(html).toContain(`Try ${product.name}`);
	}
});
