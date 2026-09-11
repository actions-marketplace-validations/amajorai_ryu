import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readComponent(fileName: string) {
	return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

describe("shared corner shape contract", () => {
	test("registers the plugin in both shared Tailwind entries", () => {
		const globals = readFileSync(
			new URL("../styles/globals.css", import.meta.url),
			"utf8"
		);
		const companionTheme = readFileSync(
			new URL("../styles/companion-theme.css", import.meta.url),
			"utf8"
		);

		expect(globals).toContain('@plugin "@toolwind/corner-shape";');
		expect(companionTheme).toContain('@plugin "@toolwind/corner-shape";');
	});

	test("keeps a rounded fallback on rectangular shared primitives", () => {
		const components = [
			"button-variants.ts",
			"input.tsx",
			"textarea.tsx",
			"checkbox.tsx",
			"card.tsx",
			"alert.tsx",
			"accordion.tsx",
			"dialog.tsx",
			"alert-dialog.tsx",
			"sheet.tsx",
			"drawer.tsx",
			"popover.tsx",
			"hover-card.tsx",
			"tooltip.tsx",
			"select.tsx",
			"native-select.tsx",
			"command.tsx",
			"dropdown-menu.tsx",
			"context-menu.tsx",
			"menubar.tsx",
			"navigation-menu.tsx",
			"toggle.tsx",
			"toggle-group.tsx",
			"input-group.tsx",
			"button-group.tsx",
			"item.tsx",
			"empty.tsx",
		] as const;

		for (const fileName of components) {
			const source = readComponent(fileName);
			expect(source, fileName).toContain("corner-squircle");
			expect(source, fileName).toMatch(/rounded(?:-|\[)/);
		}
	});
});
