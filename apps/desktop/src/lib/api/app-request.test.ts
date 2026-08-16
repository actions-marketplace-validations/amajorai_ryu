import { describe, expect, test } from "bun:test";
import { resolveOwnAppPath } from "./app-request.ts";

describe("resolveOwnAppPath", () => {
	test("keeps a request inside the owning scoped plugin", () => {
		expect(resolveOwnAppPath("@ryu/pull-requests", "/pulls?state=open")).toBe(
			"/api/ext/@ryu/pull-requests/pulls?state=open"
		);
	});

	test("rejects absolute, protocol-relative, backslash and encoded traversal", () => {
		expect(
			resolveOwnAppPath("@ryu/pull-requests", "https://evil.test/x")
		).toBeNull();
		expect(resolveOwnAppPath("@ryu/pull-requests", "//evil.test/x")).toBeNull();
		expect(resolveOwnAppPath("@ryu/pull-requests", "/..\\settings")).toBeNull();
		expect(
			resolveOwnAppPath("@ryu/pull-requests", "/%2e%2e/settings")
		).toBeNull();
	});
});
