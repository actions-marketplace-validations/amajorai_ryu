// Unit tests for `resolveRlmPath` — the desktop half of the `rlm.request` security
// boundary. The frame contributes a sub-path and nothing else; this is what decides
// whether that sub-path is a sub-path, and it is duplicated from
// `@ryu/app-host/rpc`'s `asRlmRequestArg` on purpose, because either layer alone
// would be the only thing between a sandboxed frame and the node's credentials.

import { describe, expect, it } from "bun:test";
import { resolveRlmPath } from "./rlm.ts";

describe("resolveRlmPath", () => {
	it("accepts a plain sub-path and keeps the query string", () => {
		expect(resolveRlmPath("/contexts")).toBe("/api/rlm/contexts");
		expect(resolveRlmPath("/runs?limit=5")).toBe("/api/rlm/runs?limit=5");
	});

	it("rejects anything that is not a rooted path", () => {
		// Covers every absolute URL and every bare-relative path in one clause.
		expect(resolveRlmPath("https://evil.test/x")).toBeNull();
		expect(resolveRlmPath("contexts")).toBeNull();
		expect(resolveRlmPath(42)).toBeNull();
		expect(resolveRlmPath(null)).toBeNull();
	});

	it("rejects a protocol-relative path, which resolves to a different HOST", () => {
		expect(resolveRlmPath("//evil.test/x")).toBeNull();
	});

	it("rejects a backslash, the separator parsers disagree about", () => {
		expect(resolveRlmPath("/..\\..\\etc/passwd")).toBeNull();
	});

	it("rejects traversal that only appears after URL decoding", () => {
		// The clause that matters. A literal `..` blocklist runs BEFORE the WHATWG
		// parser decodes these, so it passes them through and the request escapes the
		// mount — the `%2e%2e` lesson from the Outpost bridge.
		expect(resolveRlmPath("/../secrets")).toBeNull();
		expect(resolveRlmPath("/%2e%2e/secrets")).toBeNull();
		expect(resolveRlmPath("/contexts/../../admin")).toBeNull();
	});

	it("keeps an encoded slash as one segment rather than a separator", () => {
		// `%2f` is NOT decoded into a separator by the WHATWG parser, so this stays a
		// single segment UNDER the mount and never escapes it. Asserted explicitly
		// because the shape looks like the traversal above and the safe outcome here
		// is the opposite one — a future "hardening" that made this return null would
		// be changing behaviour it did not understand. The second gate is Core's
		// ext-proxy route allowlist, which 404s this segment: it matches no declared
		// route.
		expect(resolveRlmPath("/%2e%2e%2fsecrets")).toBe(
			"/api/rlm/%2e%2e%2fsecrets"
		);
	});

	it("allows a traversal that stays inside the mount", () => {
		// Not every `..` is an escape, and refusing these would be a bug of its own.
		expect(resolveRlmPath("/contexts/../runs")).toBe("/api/rlm/runs");
	});
});
