// Unit tests for `resolveSocialPath` — the desktop half of the `social.request`
// security boundary.
//
// The Outpost companion is a sandboxed frame holding one capability (`social:crud`)
// and one generic verb. It supplies a sub-path; this function decides whether that
// sub-path is a path under `/api/social`, and `client.ts:apiUrl` concatenates the
// result onto the node base before `fetch` sees it WITH the node bearer attached. So
// a hole here is not a bug in Outpost — it is every API on the node, reachable by
// anything that compromises a frame which renders reply text, author handles and
// permalinks fetched from third-party platforms.
//
// The function is exported precisely so this file can exist; it had no tests, which
// is how the encoded-traversal escape below survived a docstring that claimed to
// have closed it.

import { describe, expect, it } from "bun:test";

import { resolveSocialPath } from "./social.ts";

describe("resolveSocialPath", () => {
	it("prefixes an ordinary sub-path and keeps its query string", () => {
		expect(resolveSocialPath("/posts")).toBe("/api/social/posts");
		expect(resolveSocialPath("/queue?limit=5&workspace_id=default")).toBe(
			"/api/social/queue?limit=5&workspace_id=default"
		);
		expect(resolveSocialPath("/accounts/acc_1/connect")).toBe(
			"/api/social/accounts/acc_1/connect"
		);
	});

	it("rejects anything that is not a rooted sub-path", () => {
		expect(resolveSocialPath("https://evil.example/x")).toBeNull();
		// Protocol-relative: a URL parser reads this as a different HOST even though
		// it passes a naive "starts with /" check.
		expect(resolveSocialPath("//evil.example/x")).toBeNull();
		expect(resolveSocialPath("posts")).toBeNull();
		expect(resolveSocialPath("")).toBeNull();
		expect(resolveSocialPath(42)).toBeNull();
		expect(resolveSocialPath(null)).toBeNull();
		expect(resolveSocialPath(undefined)).toBeNull();
	});

	it("rejects a backslash, which some URL parsers treat as a separator", () => {
		expect(resolveSocialPath("/\\..\\settings")).toBeNull();
		expect(resolveSocialPath("/posts\\..\\..\\plugins")).toBeNull();
	});

	it("rejects a literal `..` climb out of the mount", () => {
		expect(resolveSocialPath("/../plugins")).toBeNull();
		expect(resolveSocialPath("/posts/../../settings")).toBeNull();
		expect(resolveSocialPath("/..")).toBeNull();
	});

	// ── The regression ────────────────────────────────────────────────────────────
	//
	// The guard used to be a literal `/(^|\/)\.\.(\/|$)/` over the raw string. But
	// `fetch` acts on the WHATWG URL parser's output, and that parser folds `%2e%2e`,
	// `%2E%2E`, `.%2e` and `%2e.` into double-dot segments too. Verified: `new
	// URL("http://h/api/social/%2e%2e/plugins").pathname === "/api/plugins"`. So the
	// frame could read `/api/settings`, POST to `/api/plugins/*`, reach
	// `/api/conversations` — with the host's bearer on the request, and with Core's
	// own dot-segment guard never firing, because what left the desktop was already
	// addressed to the escaped path.
	it("rejects a PERCENT-ENCODED climb, in every casing the URL parser folds", () => {
		for (const path of [
			"/%2e%2e/plugins",
			"/%2E%2E/settings",
			"/.%2e/settings",
			"/%2e./settings",
			"/%2E./settings",
		]) {
			expect(resolveSocialPath(path)).toBeNull();
		}
	});

	it("rejects a MULTI-LEVEL encoded climb, which escapes /api/* entirely", () => {
		expect(
			resolveSocialPath("/%2e%2e/%2e%2e/plugins/@ryu/social/host")
		).toBeNull();
		expect(resolveSocialPath("/posts/%2e%2e/%2e%2e/conversations")).toBeNull();
		// Mixed literal and encoded, which no single-form blocklist catches.
		expect(resolveSocialPath("/%2e%2e/../settings")).toBeNull();
	});

	it("returns the NORMALIZED path, so the host and the parser cannot disagree", () => {
		// A climb that stays inside the mount is legal — but what comes back is what
		// the parser resolved, never the frame's raw string. Handing the raw string
		// downstream is what let the two layers disagree in the first place.
		expect(resolveSocialPath("/posts/%2e%2e/drafts")).toBe("/api/social/drafts");
		expect(resolveSocialPath("/a/b/../../queue?limit=5")).toBe(
			"/api/social/queue?limit=5"
		);
	});

	it("does not admit a sibling mount that merely shares the prefix", () => {
		// `/api/socialgraph` starts with `/api/social` as a STRING but is a different
		// mount; the containment test is segment-aware for exactly this reason.
		expect(resolveSocialPath("/%2e%2e/socialgraph/secrets")).toBeNull();
	});
});
