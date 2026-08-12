// Unit tests for `resolveBlueprintPath` — the desktop half of the
// `blueprint.request` security boundary.
//
// The Blueprint companion is a sandboxed frame holding one capability
// (`blueprint:review`) and one generic verb. It supplies a sub-path; this function
// decides whether that sub-path is a path under `/api/blueprint`, and
// `client.ts:apiUrl` concatenates the result onto the node base before `fetch` sees it
// WITH the node bearer attached. So a hole here is not a bug in Blueprint — it is
// every API on the node.
//
// The exposure is slightly worse than Outpost's, which is why this file exists from
// day one rather than after the fact: the path segments here are PLAN IDS, and a plan
// id is written by an agent calling `plan_publish`, not by a human. Prompt-injected
// text that reaches an agent reaches this string.
//
// Mirrors `social.test.ts` case-for-case on purpose. The two functions are deliberate
// duplicates (each mount validates its own paths), so their tests being the same
// shape is what makes a divergence visible in review.

import { describe, expect, it } from "bun:test";

import { resolveBlueprintPath } from "./blueprint.ts";

describe("resolveBlueprintPath", () => {
	it("prefixes an ordinary sub-path and keeps its query string", () => {
		expect(resolveBlueprintPath("/plans")).toBe("/api/blueprint/plans");
		expect(resolveBlueprintPath("/plans?status=in_review")).toBe(
			"/api/blueprint/plans?status=in_review"
		);
		expect(resolveBlueprintPath("/plans/p_1/diff?from=1&to=2")).toBe(
			"/api/blueprint/plans/p_1/diff?from=1&to=2"
		);
		expect(resolveBlueprintPath("/plans/p_1/steps/s_migrate_schema")).toBe(
			"/api/blueprint/plans/p_1/steps/s_migrate_schema"
		);
	});

	it("admits the mount root itself, which `/health` and the list share", () => {
		expect(resolveBlueprintPath("/health")).toBe("/api/blueprint/health");
	});

	it("rejects anything that is not a rooted sub-path", () => {
		expect(resolveBlueprintPath("https://evil.example/x")).toBeNull();
		// Protocol-relative: a URL parser reads this as a different HOST even though
		// it passes a naive "starts with /" check.
		expect(resolveBlueprintPath("//evil.example/x")).toBeNull();
		expect(resolveBlueprintPath("plans")).toBeNull();
		expect(resolveBlueprintPath("")).toBeNull();
		expect(resolveBlueprintPath(42)).toBeNull();
		expect(resolveBlueprintPath(null)).toBeNull();
		expect(resolveBlueprintPath(undefined)).toBeNull();
	});

	it("rejects a backslash, which some URL parsers treat as a separator", () => {
		expect(resolveBlueprintPath("/\\..\\settings")).toBeNull();
		expect(resolveBlueprintPath("/plans\\..\\..\\plugins")).toBeNull();
	});

	it("rejects a literal `..` climb out of the mount", () => {
		expect(resolveBlueprintPath("/../plugins")).toBeNull();
		expect(resolveBlueprintPath("/plans/../../settings")).toBeNull();
		expect(resolveBlueprintPath("/..")).toBeNull();
	});

	// The regression `social.ts` was fixed for. A literal `/(^|\/)\.\.(\/|$)/` over the
	// raw string is not enough: `fetch` acts on the WHATWG URL parser's output, and
	// that parser folds `%2e%2e`, `%2E%2E`, `.%2e` and `%2e.` into double-dot segments
	// AFTER any literal check would have run.
	it("rejects a PERCENT-ENCODED climb, in every casing the URL parser folds", () => {
		for (const path of [
			"/%2e%2e/plugins",
			"/%2E%2E/settings",
			"/.%2e/settings",
			"/%2e./settings",
			"/%2E./settings",
		]) {
			expect(resolveBlueprintPath(path)).toBeNull();
		}
	});

	it("rejects a MULTI-LEVEL encoded climb, which escapes /api/* entirely", () => {
		expect(
			resolveBlueprintPath("/%2e%2e/%2e%2e/plugins/@ryu/blueprint/host")
		).toBeNull();
		expect(
			resolveBlueprintPath("/plans/%2e%2e/%2e%2e/conversations")
		).toBeNull();
		// Mixed literal and encoded, which no single-form blocklist catches.
		expect(resolveBlueprintPath("/%2e%2e/../settings")).toBeNull();
	});

	// The shape an injected plan id would actually take: the companion builds
	// `/plans/${id}/annotations`, so a traversal has to survive being wrapped in
	// legitimate segments on both sides.
	it("rejects a climb smuggled through the plan-id segment", () => {
		expect(
			resolveBlueprintPath("/plans/%2e%2e/%2e%2e/settings/annotations")
		).toBeNull();
		expect(resolveBlueprintPath("/plans/../../../conversations")).toBeNull();
	});

	it("returns the NORMALIZED path, so the host and the parser cannot disagree", () => {
		// A climb that stays inside the mount is legal — but what comes back is what
		// the parser resolved, never the frame's raw string. Handing the raw string
		// downstream is what let the two layers disagree in the first place.
		expect(resolveBlueprintPath("/plans/%2e%2e/plans")).toBe(
			"/api/blueprint/plans"
		);
		expect(resolveBlueprintPath("/a/b/../../plans?status=approved")).toBe(
			"/api/blueprint/plans?status=approved"
		);
	});

	it("does not admit a sibling mount that merely shares the prefix", () => {
		// `/api/blueprints` starts with `/api/blueprint` as a STRING but is a different
		// mount; the containment test is segment-aware for exactly this reason.
		expect(resolveBlueprintPath("/%2e%2e/blueprints/secrets")).toBeNull();
	});
});
