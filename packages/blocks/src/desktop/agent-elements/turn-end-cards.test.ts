import { describe, expect, it } from "bun:test";
import {
	deriveEditedFiles,
	deriveTurnEndCards,
	hasTurnEndCards,
	isTurnEndJsonRenderPart,
} from "./turn-end-cards.ts";

const releaseSpec = {
	elements: {
		card: {
			children: [],
			props: { title: "Release notes" },
			type: "Card",
		},
	},
	root: "card",
};

describe("turn-end card contract", () => {
	it("derives unique edited files and line stats from write tools", () => {
		expect(
			deriveEditedFiles([
				{
					input: {
						file_path: "src/a.ts",
						new_string: "new\nline",
						old_string: "old",
					},
					type: "tool-Edit",
				},
				{
					input: { content: "one\ntwo", file_path: "src/b.ts" },
					type: "tool-Write",
				},
				{
					input: { file_path: "src/read.ts" },
					type: "tool-Read",
				},
				{
					input: {
						patch:
							"*** Begin Patch\n*** Update File: src/a.ts\n-old\n+new\n*** Add File: src/c.ts\n+one\n+two\n*** End Patch",
					},
					type: "dynamic-tool",
					toolName: "apply_patch",
				},
			])
		).toEqual([
			{ deletions: 2, insertions: 3, path: "src/a.ts" },
			{ deletions: 0, insertions: 2, path: "src/b.ts" },
			{ deletions: 0, insertions: 2, path: "src/c.ts" },
		]);
	});

	it("does not summarize failed writes", () => {
		expect(
			deriveEditedFiles([
				{
					errorText: "permission denied",
					input: { content: "never saved", file_path: "secret.txt" },
					state: "output-error",
					type: "tool-Write",
				},
			])
		).toEqual([]);
	});

	it("does not summarize tool input that has not produced output", () => {
		expect(
			deriveTurnEndCards([
				{
					input: { file_path: "unfinished.ts", new_string: "draft" },
					state: "input-available",
					type: "tool-Write",
				},
				{
					input: { placement: "turn-end", spec: releaseSpec },
					state: "input-streaming",
					type: "tool-ui.render",
				},
			])
		).toEqual([]);
	});

	it("preserves the A2UI format for turn-end cards", () => {
		const a2uiSpec = [
			{
				version: "v0.9",
				createSurface: {
					catalogId:
						"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
					surfaceId: "status",
				},
			},
			{
				version: "v0.9",
				updateComponents: {
					components: [{ component: "Text", id: "root", text: "Ready" }],
					surfaceId: "status",
				},
			},
		];
		const part = {
			input: { format: "a2ui", placement: "turn-end", spec: a2uiSpec },
			type: "tool-ui.render",
		};

		expect(isTurnEndJsonRenderPart(part)).toBe(true);
		expect(deriveTurnEndCards([part], "assistant-a2ui")).toEqual([
			{
				format: "a2ui",
				id: "assistant-a2ui-json-0",
				kind: "json-render",
				spec: a2uiSpec,
			},
		]);
	});

	it("keeps end-of-turn JSON UI and artifact cards separate from inline UI", () => {
		const parts = [
			{
				input: {
					file_path: "docs/release.md",
					new_string: "ready",
					old_string: "draft",
				},
				type: "tool-Edit",
			},
			{
				input: { placement: "inline", spec: releaseSpec },
				type: "tool-ui.render",
			},
			{
				input: {
					placement: "turn-end",
					spec: releaseSpec,
					title: "Release reference",
				},
				type: "dynamic-tool",
				toolName: "ui.render",
			},
			{
				input: {
					artifact: {
						content: "https://example.com/release",
						kind: "code",
						title: "release.url",
					},
					placement: "turn-end",
				},
				type: "tool-artifact.render",
			},
		];

		expect(isTurnEndJsonRenderPart(parts[2])).toBe(true);
		expect(deriveTurnEndCards(parts, "assistant-1")).toEqual([
			{
				files: [{ deletions: 1, insertions: 1, path: "docs/release.md" }],
				id: "assistant-1-edited-files",
				kind: "file-edits",
			},
			{
				id: "assistant-1-json-2",
				kind: "json-render",
				spec: releaseSpec,
				title: "Release reference",
			},
			{
				artifact: {
					content: "https://example.com/release",
					kind: "code",
					title: "release.url",
				},
				id: "assistant-1-artifact-3",
				kind: "artifact",
			},
		]);
		expect(hasTurnEndCards(parts)).toBe(true);
	});

	it("ignores malformed or inline-only result parts", () => {
		expect(
			deriveTurnEndCards([
				{
					input: { placement: "inline", spec: releaseSpec },
					type: "tool-ui.render",
				},
				{
					input: { placement: "turn-end", spec: { root: "missing" } },
					type: "tool-ui.render",
				},
			])
		).toEqual([]);
	});
});
