import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "./tabs.tsx";

describe("shared tab selection indicators", () => {
	for (const manageLayout of [true, false]) {
		test(`renders one automatic indicator with layout management ${manageLayout}`, () => {
			const html = renderToStaticMarkup(
				<Tabs defaultValue="plan">
					<TabsList manageLayout={manageLayout}>
						<TabsTrigger value="plan">Plan</TabsTrigger>
						<TabsTrigger value="debug">Debug</TabsTrigger>
					</TabsList>
				</Tabs>
			);
			expect(html.match(/data-slot="tabs-indicator"/g)).toHaveLength(1);
			expect(html).toContain('aria-selected="true"');
			expect(html).toContain('aria-selected="false"');
		});
	}

	test("uses an explicitly styled indicator without adding another", () => {
		const html = renderToStaticMarkup(
			<Tabs defaultValue="yearly">
				<TabsList manageLayout={false}>
					<TabsIndicator className="bg-foreground" />
					<TabsTrigger value="monthly">Monthly</TabsTrigger>
					<TabsTrigger value="yearly">Yearly</TabsTrigger>
				</TabsList>
			</Tabs>
		);
		expect(html.match(/data-slot="tabs-indicator"/g)).toHaveLength(1);
	});

	for (const variant of ["text", "stepper"] as const) {
		test(`preserves the ${variant} treatment without a pill`, () => {
			const html = renderToStaticMarkup(
				<Tabs defaultValue="plan">
					<TabsList variant={variant}>
						<TabsTrigger value="plan">Plan</TabsTrigger>
						<TabsTrigger value="debug">Debug</TabsTrigger>
					</TabsList>
				</Tabs>
			);
			expect(html).not.toContain('data-slot="tabs-indicator"');
		});
	}
});
