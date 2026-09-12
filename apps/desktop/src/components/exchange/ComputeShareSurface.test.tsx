import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputeShareSurface } from "./ComputeShareSurface.tsx";

test("Compute keeps the live lease action unavailable until the provider network exists", () => {
	const markup = renderToStaticMarkup(<ComputeShareSurface mode="compute" />);

	expect(markup).toContain('data-testid="compute-surface"');
	expect(markup).toContain('data-exchange-state="preview"');
	expect(markup).toContain("Borrow a lane. Keep your node.");
	expect(markup).toContain("Provider network is not enabled.");
	expect(markup).toContain('disabled=""');
});

test("Share exposes both provider offer modes without claiming publication", () => {
	const markup = renderToStaticMarkup(<ComputeShareSurface mode="share" />);

	expect(markup).toContain('data-testid="share-surface"');
	expect(markup).toContain("Compute lane");
	expect(markup).toContain("Hosted agent");
	expect(markup).toContain("Provider enrollment is not enabled.");
	expect(markup).toContain("The host boundary");
});
