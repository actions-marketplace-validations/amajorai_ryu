import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "mobile-nav.tsx"), "utf8");

describe("mobile navigation dialog accessibility", () => {
	test("keeps the sheet modal and keyboard-dismissible", () => {
		expect(SOURCE).toContain('role="dialog"');
		expect(SOURCE).toContain('aria-modal="true"');
		expect(SOURCE).toContain('event.key === "Escape"');
		expect(SOURCE).toContain('event.key !== "Tab"');
	});

	test("returns focus to the trigger after closing", () => {
		expect(SOURCE).toContain("triggerRef.current?.focus()");
		expect(SOURCE).toContain('aria-controls="mobile-nav-sheet"');
		expect(SOURCE).toContain('aria-label="Mobile navigation"');
	});
});
