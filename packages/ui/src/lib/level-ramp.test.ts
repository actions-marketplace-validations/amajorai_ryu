import { describe, expect, it } from "bun:test";
import { levelFillColor } from "./level-ramp.ts";

describe("levelFillColor", () => {
	it("spreads the shared effort ramp across a five-step ladder", () => {
		expect(levelFillColor(1, 5)).toBe(
			"color-mix(in oklab, var(--success) 55%, transparent)"
		);
		expect(levelFillColor(2, 5)).toContain("var(--warning)");
		expect(levelFillColor(3, 5)).toContain("var(--destructive)");
		expect(levelFillColor(4, 5)).toContain("var(--effort-top) 100%");
	});

	it("keeps the three-step buyer ladder on the same endpoints", () => {
		expect(levelFillColor(1, 3)).toContain("var(--success)");
		expect(levelFillColor(2, 3)).toContain("var(--effort-top)");
	});
});
