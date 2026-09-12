import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OgCard, ogLabel } from "./og-card.tsx";

describe("social card composition", () => {
	it("keeps the default centered brand and the Pro badge background", () => {
		const html = renderToStaticMarkup(<OgCard />);
		expect(html).toContain("data:image/png;base64,");
		expect(html).toContain("112px");
		expect(html).not.toContain("border:");
	});
	it("renders one title and a short context without repeating it", () => {
		const html = renderToStaticMarkup(
			<OgCard eyebrow="Marketplace" title="Marketplace" />
		);
		expect(html.match(/>Marketplace</g)).toHaveLength(1);
		expect(html).not.toContain("Ryu Marketplace");
		expect(html).not.toContain("border:");
	});
	it.each(["App", "Model", "Skill", "Plugin", "Agent", "Workflow", "Marketplace", "Blog", "Docs"])("uses a plain Ryu %s label without bullets", (context) => {
 const html = renderToStaticMarkup(<OgCard title="Example" eyebrow={context} />);
 expect(html).toContain(`Ryu ${context}`);
 expect(html).not.toMatch(/[·•]/u);
 });
	it("normalizes whitespace and preserves Unicode when shortening names", () => {
		expect(ogLabel("  Browser\n app  ")).toBe("Browser app");
		expect(ogLabel("😀😀😀", 2)).toBe("😀…");
		expect(ogLabel(undefined)).toBe("");
	});
	it("escapes user authored names instead of interpreting HTML", () => {
		const html = renderToStaticMarkup(
			<OgCard title="<script>alert(1)</script>" />
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});
});
