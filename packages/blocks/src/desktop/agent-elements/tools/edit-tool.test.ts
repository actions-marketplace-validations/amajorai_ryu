import { describe, expect, it } from "bun:test";
import { diffLines } from "../utils/diff-lines.ts";

describe("diffLines", () => {
	it("marks an insertion in the middle as one added row with surrounding context", () => {
		const lines = diffLines("a\nb\nc", "a\nx\nb\nc");
		expect(lines.map((l) => l.type)).toEqual([
			"context",
			"added",
			"context",
			"context",
		]);
		const added = lines.find((l) => l.type === "added");
		expect(added).toMatchObject({ content: "x", newLine: 2 });
		expect(added?.oldLine).toBeUndefined();
	});

	it("marks a deletion as a removed row without a new line number", () => {
		const lines = diffLines("a\nb\nc", "a\nc");
		expect(lines.map((l) => l.type)).toEqual(["context", "removed", "context"]);
		const removed = lines.find((l) => l.type === "removed");
		expect(removed).toMatchObject({ content: "b", oldLine: 2 });
		expect(removed?.newLine).toBeUndefined();
	});

	it("a replacement is one removed + one added row", () => {
		const lines = diffLines("a\nb\nc", "a\nB\nc");
		const types = lines.map((l) => l.type);
		expect(types).toContain("removed");
		expect(types).toContain("added");
		expect(lines.filter((l) => l.type === "context")).toHaveLength(2);
	});

	it("identical inputs emit only context rows with matching line numbers", () => {
		const lines = diffLines("a\nb", "a\nb");
		expect(lines.map((l) => l.type)).toEqual(["context", "context"]);
		expect(lines[0]).toMatchObject({ oldLine: 1, newLine: 1 });
		expect(lines[1]).toMatchObject({ oldLine: 2, newLine: 2 });
	});

	it("an empty old text is all additions; empty new text all removals", () => {
		// `"".split("\n")` is `[""]` — one empty line — so a one-sided empty
		// diff emits that phantom line as a removed row (old side) or an added
		// row (new side) plus the real rows. The callers guard against both
		// being empty before reaching here; this pins the one-sided shape.
		const additions = diffLines("", "a\nb");
		expect(
			additions.filter((l) => l.type === "added").map((l) => l.content)
		).toEqual(["a", "b"]);

		const removals = diffLines("a\nb", "");
		expect(
			removals.filter((l) => l.type === "removed").map((l) => l.content)
		).toEqual(["a", "b"]);
	});

	it("emits unique ids so the beUI FileDiff rows never collide", () => {
		const lines = diffLines("a\nb", "a\nc\nb");
		const ids = new Set(lines.map((l) => l.id));
		expect(ids.size).toBe(lines.length);
	});
});
