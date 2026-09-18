import { describe, expect, it } from "bun:test";
import { QRCode } from "@ryu/ui/components/qr-code.tsx";
import { renderToStaticMarkup } from "react-dom/server";

describe("login approval QR", () => {
	it("renders a scannable Better Auth verification URL", () => {
		const markup = renderToStaticMarkup(
			<QRCode
				aria-label="Scan this sign-in QR code with Ryu Mobile"
				bgColor="#ffffff"
				fgColor="#000000"
				size={196}
				value="https://app.example/device?user_code=ABCD2345"
			/>
		);

		expect(markup).toContain("Scan this sign-in QR code with Ryu Mobile");
		expect(markup).toContain('viewBox="0 0 196 196"');
	});
});
