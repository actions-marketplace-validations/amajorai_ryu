import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Select, SelectTrigger } from "./select.tsx";

describe("SelectTrigger", () => {
	test("defaults to the ghost trigger styling", () => {
		const html = renderToStaticMarkup(
			<Select>
				<SelectTrigger>Choose an option</SelectTrigger>
			</Select>
		);

		expect(html).toContain("bg-transparent");
		expect(html).toContain("hover:bg-muted");
		expect(html).not.toContain("bg-input/50");
	});

	test("keeps the filled trigger styling when requested explicitly", () => {
		const html = renderToStaticMarkup(
			<Select>
				<SelectTrigger variant="default">Choose an option</SelectTrigger>
			</Select>
		);

		expect(html).toContain("bg-input/50");
		expect(html).not.toContain("bg-transparent");
	});

	test("wraps direct trigger text in the shared measured label", () => {
		const html = renderToStaticMarkup(
			<Select>
				<SelectTrigger className="w-32">
					A label that can outgrow the select
				</SelectTrigger>
			</Select>
		);

		expect(html).toContain("overflow-hidden");
		expect(html).toContain("whitespace-nowrap");
		expect(html).toContain("A label that can outgrow the select");
	});
});
