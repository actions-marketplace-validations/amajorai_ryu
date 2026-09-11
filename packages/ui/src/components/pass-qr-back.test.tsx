import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PassQrBack } from "./pass-qr-back.tsx";

describe("PassQrBack", () => {
	test("renders a high-correction dot QR with the Ryu center mark", () => {
		const markup = renderToStaticMarkup(
			<PassQrBack
				caption="Scan to share"
				metalTheme="light"
				seed="pilot"
				value="https://ryuhq.com/r/ABCD2345"
			/>
		);

		expect(markup).toContain('aria-label="Scan to share"');
		expect(markup).toContain('viewBox="0 0 224 224"');
		expect((markup.match(/<circle/g) ?? []).length).toBeGreaterThan(20);
		expect(markup).toContain("Scan to share");
		expect((markup.match(/<path/g) ?? []).length).toBeGreaterThan(0);
		expect((markup.match(/<ellipse/g) ?? []).length).toBeGreaterThan(0);
	});

	test("does not pretend to encode a link while the destination is missing", () => {
		const markup = renderToStaticMarkup(
			<PassQrBack caption="Scan to invite" seed="pilot" value={null} />
		);

		expect(markup).toContain("Invite link is preparing");
		expect(markup).not.toContain('viewBox="0 0 224 224"');
	});
});
