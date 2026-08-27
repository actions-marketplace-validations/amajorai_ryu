import { describe, expect, test } from "bun:test";
import { canBindNode } from "./NodeOrganizationBindingCard.tsx";

describe("node organization binding access", () => {
	test("allows the live gateway.configure permission regardless of role name", () => {
		expect(canBindNode(["gateway.view", "gateway.configure"])).toBe(true);
	});

	test("keeps missing, loading, and read-only permissions non-mutating", () => {
		expect(canBindNode(undefined)).toBe(false);
		expect(canBindNode([])).toBe(false);
		expect(canBindNode(["gateway.view", "billing.manage"])).toBe(false);
	});
});
