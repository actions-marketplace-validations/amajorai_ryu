import { describe, expect, it } from "bun:test";
import { resolveSafeActionsPath } from "./safe-actions.ts";

describe("resolveSafeActionsPath", () => {
	it("contains valid paths under the fixed Core mount", () => {
		expect(resolveSafeActionsPath("/policies")).toBe(
			"/api/tools/plans/policies"
		);
		expect(resolveSafeActionsPath("/reviews/r-1/approve")).toBe(
			"/api/tools/plans/reviews/r-1/approve"
		);
	});

	it("rejects parser traversal and cross-surface paths", () => {
		for (const path of [
			"/../mcp/tools",
			"/%2e%2e/mcp/tools",
			"//evil.example/x",
			"https://evil.example/x",
			"/receipts?all=1",
			"/receipts#proof",
			"/receipts\\..\\mcp",
		]) {
			expect(resolveSafeActionsPath(path)).toBeNull();
		}
	});
});
