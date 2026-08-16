import { expect, test } from "bun:test";
import { toolDiffLines } from "../../components/ui/diff.tsx";
import { parseMarkdownBlocks } from "../../components/ui/markdown.tsx";

test("parses fenced Markdown, including an unfinished streaming fence", () => {
	expect(parseMarkdownBlocks("before\n\n```ts\nconst answer = 42;\n")).toEqual([
		{ type: "text", lines: ["before", ""] },
		{ type: "code", language: "ts", code: "const answer = 42;\n" },
	]);
});

test("renders Edit args as a readable unified diff model", () => {
	expect(
		toolDiffLines("Edit", {
			file_path: "src/example.ts",
			old_string: "old line",
			new_string: "new line",
		})
	).toEqual([
		{ kind: "header", text: "--- src/example.ts" },
		{ kind: "header", text: "+++ src/example.ts" },
		{ kind: "removed", text: "- old line" },
		{ kind: "added", text: "+ new line" },
	]);
});

test("renders ApplyPatch text and ignores unrelated tools", () => {
	expect(
		toolDiffLines("ApplyPatch", {
			patch: "--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+new",
		})
	).toEqual([
		{ kind: "header", text: "--- a/example.ts" },
		{ kind: "header", text: "+++ b/example.ts" },
		{ kind: "header", text: "@@ -1 +1 @@" },
		{ kind: "removed", text: "-old" },
		{ kind: "added", text: "+new" },
	]);
	expect(
		toolDiffLines("Bash", { old_string: "a", new_string: "b" })
	).toBeNull();
});
