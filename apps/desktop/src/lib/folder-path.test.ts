// The regression: an auto-imported agent thread and a chat Ryu started in the
// same directory produced two sidebar project folders with the same name,
// because the union that builds that list compared raw strings and the two
// producers spell a path differently.

import { describe, expect, test } from "bun:test";
import { dedupeFolders, folderKey, sameFolder } from "./folder-path.ts";

describe("folderKey", () => {
	test("a trailing separator does not make a second folder", () => {
		expect(sameFolder("/Users/j/Code/ryu/", "/Users/j/Code/ryu")).toBe(true);
	});

	test("a doubled separator does not make a second folder", () => {
		expect(sameFolder("/Users/j//Code/ryu", "/Users/j/Code/ryu")).toBe(true);
	});

	test("surrounding whitespace is ignored", () => {
		expect(sameFolder("  /Users/j/Code  ", "/Users/j/Code")).toBe(true);
	});

	test("Windows and POSIX spellings of one path agree", () => {
		expect(sameFolder("C:\\Users\\j\\Code", "C:/Users/j/Code")).toBe(true);
	});

	test("roots survive rather than collapsing to nothing", () => {
		expect(folderKey("/")).toBe("/");
	});

	test("case is NOT folded — the leaf is the project's display name", () => {
		expect(sameFolder("/Users/J/Code", "/Users/j/Code")).toBe(false);
	});

	test("genuinely different folders stay different", () => {
		expect(sameFolder("/Users/j/Code/ryu", "/Users/j/Code/ryu2")).toBe(false);
	});
});

describe("dedupeFolders", () => {
	test("keeps the first spelling and drops equivalent later ones", () => {
		expect(
			dedupeFolders(["/Users/j/Code", "/Users/j/Code/", "/Users/j/Other"])
		).toEqual(["/Users/j/Code", "/Users/j/Other"]);
	});
});
