import { describe, expect, test } from "bun:test";
import { isUnstableRelease, versionStabilityLabel } from "./stability.ts";

describe("marketplace stability", () => {
	test("treats missing and explicit stable values as finished", () => {
		expect(isUnstableRelease(undefined)).toBe(false);
		expect(isUnstableRelease(null)).toBe(false);
		expect(isUnstableRelease("  ")).toBe(false);
		expect(isUnstableRelease(" Stable ")).toBe(false);
	});

	test("treats known and future maturity values as unstable", () => {
		expect(isUnstableRelease("alpha")).toBe(true);
		expect(isUnstableRelease("Beta")).toBe(true);
		expect(isUnstableRelease("experimental")).toBe(true);
		expect(isUnstableRelease("Preview")).toBe(true);
	});

	test("labels historical maturity without claiming unavailable metadata", () => {
		expect(versionStabilityLabel("stable", true, false)).toBe("Stable");
		expect(versionStabilityLabel("stable", false, false)).toBe("Stable");
		expect(versionStabilityLabel("beta", true, true)).toBe("Beta");
		expect(versionStabilityLabel(null, false, true)).toBe("Pre-release");
		expect(versionStabilityLabel(null, false, false)).toBe(
			"Stability unavailable"
		);
	});
});
