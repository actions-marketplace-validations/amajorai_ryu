import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	RyuAppEmpty,
	RyuAppField,
	RyuAppList,
	RyuAppListItem,
	RyuAppShell,
	RyuAppToolbar,
} from "./app-ui.tsx";

describe("Ryu App UI", () => {
	test("renders the fixed shell contract", () => {
		const html = renderToStaticMarkup(
			<RyuAppShell surface="editor">
				<RyuAppToolbar title="Projects" />
			</RyuAppShell>
		);

		expect(html).toContain('data-ryu-app-ui="v1"');
		expect(html).toContain('data-ryu-surface="editor"');
		expect(html).toContain("ryu-app-toolbar__title");
	});

	test("renders list rows with fixed selection semantics", () => {
		const html = renderToStaticMarkup(
			<RyuAppList aria-label="Projects">
				<RyuAppListItem selected subtitle="Updated today" title="Ryu" />
			</RyuAppList>
		);

		expect(html).toContain('role="listbox"');
		expect(html).toContain('data-selected="true"');
		expect(html).toContain("Updated today");
	});

	test("renders shared form and empty-state roles", () => {
		const html = renderToStaticMarkup(
			<div>
				<RyuAppField description="Optional" label="Name">
					<input aria-label="Name" />
				</RyuAppField>
				<RyuAppEmpty
					description="Create your first project."
					title="Nothing here"
				/>
			</div>
		);

		expect(html).toContain("ryu-app-field__label");
		expect(html).toContain("ryu-app-empty__description");
	});
});
