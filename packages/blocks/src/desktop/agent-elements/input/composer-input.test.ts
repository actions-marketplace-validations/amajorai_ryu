import { expect, test } from "bun:test";
import { hasComposerInput } from "./composer-input.ts";

test("treats attachments as input when the composer text is empty", () => {
	expect(hasComposerInput("", 1)).toBe(true);
	expect(hasComposerInput("\n  ", 2)).toBe(true);
});

test("requires text or an attachment", () => {
	expect(hasComposerInput("   ", 0)).toBe(false);
	expect(hasComposerInput("Review this", 0)).toBe(true);
});
