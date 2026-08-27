import { describe, expect, test } from "bun:test";

import {
	deterministicAssistantAnswer,
	findRelevantDocs,
	RYU_DOC_REFERENCES,
	resolveDocHref,
} from "./docs.ts";

describe("assistant docs grounding", () => {
	test("ranks the matching public source", () => {
		expect(
			findRelevantDocs("How do I ship a customer support widget?")[0]
		).toMatchObject({
			title: "Ship a support widget",
		});
	});

	test("has a deterministic useful answer before a model is downloaded", () => {
		expect(
			deterministicAssistantAnswer(
				"What is Ryu?",
				findRelevantDocs("What is Ryu?")
			)
		).toContain("governed production AI platform");
	});

	test("keeps docs links on the configured public origin", () => {
		expect(
			resolveDocHref("https://docs.ryuhq.com/", "/docs/surfaces/webapp")
		).toBe("https://docs.ryuhq.com/docs/surfaces/webapp");
		expect(resolveDocHref(undefined, "/docs/surfaces/webapp")).toBe(
			"/docs/surfaces/webapp"
		);
	});

	test("uses valid public documentation routes", () => {
		expect(RYU_DOC_REFERENCES.map((reference) => reference.href)).toEqual([
			"/docs/start-here/architecture/three-products",
			"/docs/extend/develop/sdk",
			"/docs/extend/develop/extensions/support-widget",
			"/docs/surfaces/browser-extension",
			"/docs/surfaces/webapp",
			"/docs/extend/mcp/llms",
		]);
	});
});
