import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionsPanel } from "./detail-panels.tsx";
import { SupportExtensionPanel } from "./support-extension-panel.tsx";

describe("VersionsPanel", () => {
	test("shows the manifest maturity for published versions", () => {
		const html = renderToStaticMarkup(
			<VersionsPanel
				versions={[
					{
						stability: "stable",
						stabilityKnown: true,
						version: "2.0.0",
					},
					{
						prerelease: true,
						stability: "beta",
						stabilityKnown: true,
						version: "1.5.0-beta.1",
					},
				]}
			/>
		);

		expect(html).toContain("Stable");
		expect(html).toContain("Beta");
	});

	test("offers exact install only for non-tag-only history", () => {
		const html = renderToStaticMarkup(
			<VersionsPanel
				installVersion={() => Promise.resolve()}
				versions={[
					{ installable: true, version: "2.0.0" },
					{ installable: true, version: "1.5.0" },
					{ tagOnly: true, version: "1.0.0" },
				]}
			/>
		);

		expect(html.match(/Install this version/g)).toHaveLength(2);
	});
});

describe("SupportExtensionPanel", () => {
	test("shows support, extension, and implementation as separate facts", () => {
		const html = renderToStaticMarkup(
			<SupportExtensionPanel
				detail={{
					extensions: [
						{
							features: ["browser.control"],
							label: "Browser",
							target: "browser",
						},
					],
					implementation: [
						{
							features: ["capability broker"],
							label: "Core runtime",
							layer: "core",
						},
					],
					surfaceSupport: [
						{ surface: "desktop", support: "full" },
						{
							inheritedFrom: "desktop",
							surface: "mobile",
							support: "limited",
						},
					],
				}}
				entry={{
					description: "Browser",
					id: "@ryu/browser",
					kinds: ["tool"],
					name: "Browser",
					tags: [],
					version: "1.0.0",
				}}
			/>
		);

		expect(html).toContain("Support &amp; extensions");
		expect(html).toContain("Uses the shared Desktop shell");
		expect(html).toContain("Extends");
		expect(html).toContain("Where it lives");
		expect(html).toContain("browser.control");
	});
});
