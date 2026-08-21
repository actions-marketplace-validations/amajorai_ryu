import { describe, expect, test } from "bun:test";
import {
	type ComposerMentionItem,
	mentionMarkdown,
	serializeComposerMarkdown,
} from "./composer-editor.tsx";

const items: ComposerMentionItem[] = [
	{ id: "page-1", kind: "page", label: "Project Atlas" },
	{ id: "app-1", kind: "app", label: "Calendar" },
];

describe("composer Markdown transport", () => {
	test("round-trips known mentions as editor links without changing normal Markdown", () => {
		const source =
			"Plan with @Project Atlas and [the docs](https://example.com).";
		const editorMarkdown = mentionMarkdown(source, items);

		expect(editorMarkdown).toContain("[@Project Atlas](mention:page-1)");
		expect(editorMarkdown).toContain("[the docs](https://example.com)");
		expect(serializeComposerMarkdown(editorMarkdown)).toBe(source);
	});

	test("leaves unknown links intact and restores an unprefixed mention label", () => {
		const source = "[external](https://example.com) [Atlas](mention:page-1)";

		expect(serializeComposerMarkdown(source)).toBe(
			"[external](https://example.com) @Atlas"
		);
	});
});
