import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionsPanel } from "./detail-panels.tsx";

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
