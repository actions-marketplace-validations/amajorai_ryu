import { describe, expect, test } from "bun:test";
import { resolveProductMode } from "./product-mode.ts";

describe("desktop product surface", () => {
	test("keeps OS available without Console organization access", () => {
		expect(resolveProductMode("os", false)).toBe("os");
		expect(resolveProductMode("bot", false)).toBe("bot");
	});

	test("fails a stale Console preference closed when access is denied", () => {
		expect(resolveProductMode("console", false)).toBe("bot");
		expect(resolveProductMode("console", true)).toBe("console");
	});
});
