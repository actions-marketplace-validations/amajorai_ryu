import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCode } from "./qr-code.tsx";

describe("QRCode", () => {
	test("renders the Spell-style finder patterns and dot modules", () => {
		const markup = renderToStaticMarkup(
			<QRCode aria-label="Pair this device" size={180} value="ryu://pair/7" />
		);

		expect(markup).toContain('aria-label="Pair this device"');
		expect(markup).toContain('viewBox="0 0 180 180"');
		expect(markup.match(/<g/g)).toHaveLength(3);
		expect((markup.match(/<circle/g) ?? []).length).toBeGreaterThan(20);
	});

	test("returns no SVG for an empty value", () => {
		expect(renderToStaticMarkup(<QRCode value="" />)).toBe("");
	});
});
