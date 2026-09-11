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
			<RyuAppShell initialLocale="es-MX" surface="editor">
				<RyuAppToolbar title="Apps" />
			</RyuAppShell>
		);

		expect(html).toContain('data-ryu-app-ui="v1"');
		expect(html).toContain('data-ryu-surface="editor"');
		expect(html).toContain("ryu-app-toolbar__title");
		expect(html).toContain(">Aplicaciones</h1>");
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
			<RyuAppShell initialLocale="es">
				<RyuAppField description="Optional" label="Name">
					<input aria-label="Name" />
				</RyuAppField>
				<RyuAppEmpty
					description="Create your first project."
					title="No results"
				/>
			</RyuAppShell>
		);

		expect(html).toContain("ryu-app-field__label");
		expect(html).toContain("ryu-app-empty__description");
		expect(html).toContain(">Sin resultados</h2>");
		expect(html).toContain(">Nombre</span>");
	});
});
