import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateStepView } from "./UpdateStep.tsx";

describe("desktop onboarding update preference", () => {
	it("defaults to background download while promising an install prompt", () => {
		const html = renderToStaticMarkup(
			<UpdateStepView
				automaticDownload={true}
				onContinue={() => undefined}
				status="up-to-date"
			/>
		);

		expect(html).toContain("Download updates automatically");
		expect(html).toContain(
			"Download updates in the background. Ryu asks before installing and restarting."
		);
		expect(html).toContain('aria-label="Download app updates automatically"');
		expect(html).toContain('aria-checked="true"');
	});

	it("offers installation only after the update is prepared", () => {
		const html = renderToStaticMarkup(
			<UpdateStepView
				automaticDownload={true}
				onContinue={() => undefined}
				onInstall={() => undefined}
				prepared={true}
				status="available"
			/>
		);

		expect(html).toContain("Install and restart");
		expect(html).not.toContain("Download and install");
	});
});
