import { describe, expect, it } from "bun:test";
import { limitConsoleText, MAX_CONSOLE_COPY_LINES } from "./console-buffer.ts";

describe("limitConsoleText", () => {
	it("caps copied output at 5,000 lines and keeps the newest lines", () => {
		const input = Array.from(
			{ length: MAX_CONSOLE_COPY_LINES + 25 },
			(_, index) => `console-${index}`
		).join("\n");

		const output = limitConsoleText(input);

		expect(output.split("\n")).toHaveLength(MAX_CONSOLE_COPY_LINES);
		expect(output).toContain("earlier console lines omitted");
		expect(output).toContain(`console-${MAX_CONSOLE_COPY_LINES + 24}`);
		expect(output).not.toContain("console-0");
	});

	it("leaves short output unchanged", () => {
		const input = "first line\nsecond line";

		expect(limitConsoleText(input)).toBe(input);
	});
});
