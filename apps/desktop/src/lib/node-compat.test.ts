// apps/desktop/src/lib/node-compat.test.ts
//
// Tests for the node version floor + capability negotiation. Both are
// deliberately FAIL-SOFT: an unparseable/absent version or capability list must
// never falsely hide a feature (the version banner warns instead). These tests
// pin the semver comparison ladder, the compatibility floor, and the
// "no list ⇒ has everything" capability rule.

import { describe, expect, it } from "bun:test";
import {
	channelMismatch,
	channelOf,
	compareSemver,
	hasCapability,
	isNodeCompatible,
	MIN_CORE_VERSION,
} from "./node-compat.ts";

describe("compareSemver", () => {
	it("orders by major, then minor, then patch", () => {
		expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
		expect(compareSemver("1.2.0", "1.1.0")).toBe(1);
		expect(compareSemver("1.1.1", "1.1.2")).toBe(-1);
		expect(compareSemver("1.1.1", "1.1.1")).toBe(0);
	});

	it("tolerates a leading v and surrounding whitespace", () => {
		expect(compareSemver("  v1.2.3 ", "1.2.3")).toBe(0);
		expect(compareSemver("v2.0.0", "v1.9.9")).toBe(1);
	});

	it("ignores a pre-release/build suffix (matches the numeric core only)", () => {
		expect(compareSemver("1.2.3-beta.1", "1.2.3")).toBe(0);
	});

	it("fails soft to equal (0) when EITHER side is unparseable", () => {
		expect(compareSemver("not-a-version", "1.0.0")).toBe(0);
		expect(compareSemver("1.0.0", "garbage")).toBe(0);
		expect(compareSemver("", "")).toBe(0);
	});
});

describe("isNodeCompatible", () => {
	it("treats an absent version as compatible (fail-soft)", () => {
		expect(isNodeCompatible(null)).toBe(true);
		expect(isNodeCompatible(undefined)).toBe(true);
		expect(isNodeCompatible("")).toBe(true);
	});

	it("accepts a version at or above the floor", () => {
		expect(isNodeCompatible(MIN_CORE_VERSION)).toBe(true);
		expect(isNodeCompatible("9.9.9")).toBe(true);
	});

	it("rejects a parseable version below the floor", () => {
		expect(isNodeCompatible("0.0.0")).toBe(false);
	});

	it("treats an unparseable version as compatible (equal, fail-soft)", () => {
		expect(isNodeCompatible("dev-build")).toBe(true);
	});
});

describe("hasCapability", () => {
	it("reports true for a listed capability", () => {
		expect(hasCapability(["ghost", "shadow"], "shadow")).toBe(true);
	});

	it("reports false for an absent capability when a list is present", () => {
		expect(hasCapability(["ghost"], "shadow")).toBe(false);
	});

	it("treats an undefined or empty list as legacy 'has everything'", () => {
		expect(hasCapability(undefined, "anything")).toBe(true);
		expect(hasCapability([], "anything")).toBe(true);
	});
});

describe("channelOf", () => {
	it("reads the channel out of the version itself", () => {
		// Mirrors Core's channel_of, so both sides agree without storing anything.
		expect(channelOf("0.0.18")).toBe("stable");
		expect(channelOf("v0.0.18")).toBe("stable");
		expect(channelOf("0.0.18-nightly.20260802.23")).toBe("nightly");
		expect(channelOf("0.0.18-canary.4")).toBe("canary");
		expect(channelOf("0.0.18-beta.1")).toBe("beta");
		// Build metadata is not a channel.
		expect(channelOf("0.0.18-nightly.3+f1a68ac")).toBe("nightly");
		expect(channelOf("0.0.18+f1a68ac")).toBe("stable");
	});

	it("fails soft on a missing version", () => {
		expect(channelOf(null)).toBe("stable");
		expect(channelOf(undefined)).toBe("stable");
		expect(channelOf("")).toBe("stable");
	});
});

describe("channelMismatch", () => {
	it("catches skew the version floor cannot see", () => {
		// The exact blind spot: compareSemver discards the prerelease, so these two
		// compare EQUAL and no version check could ever flag them.
		expect(compareSemver("0.0.18", "0.0.18-canary.4")).toBe(0);
		expect(channelMismatch("0.0.18", "0.0.18-canary.4")).toEqual({
			desktop: "stable",
			node: "canary",
		});
	});

	it("is silent when both sides agree", () => {
		expect(channelMismatch("0.0.18", "0.0.19")).toBeNull();
		expect(channelMismatch("0.0.18-nightly.1", "0.0.19-nightly.2")).toBeNull();
	});

	it("fails soft when either version is unknown", () => {
		expect(channelMismatch(null, "0.0.18-canary.1")).toBeNull();
		expect(channelMismatch("0.0.18", null)).toBeNull();
	});
});
