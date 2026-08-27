import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "./card.tsx";

describe("Card surface", () => {
	test("uses the card background without a default shadow", () => {
		const html = renderToStaticMarkup(<Card>Content</Card>);

		expect(html).toContain("bg-card");
		expect(html).not.toMatch(/\bshadow(?:-[^\s"]+)?\b/);
	});
});
