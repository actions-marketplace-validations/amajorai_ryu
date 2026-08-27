import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerMenu } from "./composer-menu.tsx";

describe("ComposerMenu", () => {
	test("shows an explicit empty state after filtering", () => {
		const html = renderToStaticMarkup(
			<ComposerMenu
				groups={[
					{
						id: "apps",
						items: [{ id: "calendar", label: "Calendar" }],
						label: "Apps",
					},
				]}
				onDismiss={() => undefined}
				onSelect={() => undefined}
				query="does-not-exist"
			/>
		);

		expect(html).toContain("No results found");
	});
});
