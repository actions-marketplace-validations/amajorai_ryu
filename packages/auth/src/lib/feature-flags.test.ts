import { describe, expect, it } from "bun:test";
import {
	defaultFeatureFlags,
	FEATURE_FLAGS,
	featureFlagByKey,
	featureFlagFallback,
	resolveFeatureFlags,
} from "./feature-flags.ts";

describe("FEATURE_FLAGS catalog invariants", () => {
	it("has no duplicate keys", () => {
		const keys = FEATURE_FLAGS.map((flag) => flag.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("namespaces every key by surface so it cannot collide with FEATURES", () => {
		// `FEATURES` (features.ts) owns bare keys like `managed_inference`. The two
		// answer different questions and must never be readable as one axis.
		for (const flag of FEATURE_FLAGS) {
			expect(flag.key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
		}
	});

	it("defaults every fail-closed flag to off", () => {
		// The whole point of `failMode: "closed"`: a client that has never read the
		// map must not show a money-adjacent surface.
		for (const flag of FEATURE_FLAGS) {
			if (flag.failMode === "closed") {
				expect(flag.defaultValue).toBe(false);
			}
		}
	});
});

describe("featureFlagByKey / featureFlagFallback", () => {
	it("resolves a known key to its definition", () => {
		expect(featureFlagByKey("ui.managed_inference_card")?.failMode).toBe(
			"closed"
		);
	});

	it("returns undefined for an unknown key", () => {
		expect(featureFlagByKey("ui.does_not_exist")).toBeUndefined();
	});

	it("defaults ui.managed_inference_card to false", () => {
		expect(featureFlagFallback("ui.managed_inference_card")).toBe(false);
	});

	it("falls back to false for a key this build has never heard of", () => {
		expect(featureFlagFallback("ui.shipped_after_this_build")).toBe(false);
	});
});

describe("resolveFeatureFlags", () => {
	it("equals the catalog defaults with no overrides", () => {
		expect(resolveFeatureFlags()).toEqual(defaultFeatureFlags());
		expect(resolveFeatureFlags({ overrides: null })).toEqual(
			defaultFeatureFlags()
		);
		expect(resolveFeatureFlags({ overrides: {} })).toEqual(
			defaultFeatureFlags()
		);
	});

	it("flips a known key from an override", () => {
		const resolved = resolveFeatureFlags({
			overrides: { "ui.managed_inference_card": true },
		});
		expect(resolved["ui.managed_inference_card"]).toBe(true);
	});

	it("ignores unknown override keys so a new key never breaks an old client", () => {
		const resolved = resolveFeatureFlags({
			overrides: { "ui.a_key_from_a_future_release": true },
		});
		expect(resolved).toEqual(defaultFeatureFlags());
		expect(resolved["ui.a_key_from_a_future_release"]).toBeUndefined();
	});

	it("ignores a non-boolean override rather than coercing it", () => {
		// The override map comes from a hand-edited env var; `"true"` as a string
		// must not silently read as ON, and `null` must not read as OFF-by-cast.
		const overrides = {
			"ui.managed_inference_card": "true",
		} as unknown as Record<string, boolean>;
		expect(resolveFeatureFlags({ overrides })).toEqual(defaultFeatureFlags());
	});

	it("applies global overrides for a null organizationId", () => {
		// The self-hosted individual (`scope: "user"`, no org) is EXACTLY the
		// population this flag targets. If null resolved to defaults the card would
		// never appear for them.
		const resolved = resolveFeatureFlags({
			organizationId: null,
			overrides: { "ui.managed_inference_card": true },
		});
		expect(resolved["ui.managed_inference_card"]).toBe(true);
	});

	it("returns a fresh map each call (callers must not share mutable state)", () => {
		const first = resolveFeatureFlags();
		first["ui.managed_inference_card"] = true;
		expect(resolveFeatureFlags()["ui.managed_inference_card"]).toBe(false);
	});
});
