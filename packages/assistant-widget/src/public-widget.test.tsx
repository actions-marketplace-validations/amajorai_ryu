import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RyuAssistantWidget } from "./public-widget";

describe("RyuAssistantWidget", () => {
	test("uses the shared Island morph as its launcher", () => {
		const html = renderToStaticMarkup(<RyuAssistantWidget />);

		expect(html).toContain('aria-label="Open Ask Ryu"');
		expect(html).not.toContain("Ryu local assistant");
	});

	test("keeps browser and local-node switching inside the shared widget", () => {
		const html = renderToStaticMarkup(
			<RyuAssistantWidget
				initialMode="node"
				inline
				openOnMount
				showLauncher={false}
			/>
		);

		expect(html).toContain("Browser");
		expect(html).toContain("Local node");
		expect(html).toContain("Local Ryu node address");
	});
});
