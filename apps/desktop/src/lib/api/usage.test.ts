import { describe, expect, test } from "bun:test";
import { supportsSubscriptionProviderUsage, supportsUsage } from "./usage.ts";

describe("subscription provider usage eligibility", () => {
	test("accepts configured Ryu OAuth providers supported by Core", () => {
		for (const id of ["openai-codex", "claude-pro-max", "github-copilot"]) {
			expect(
				supportsSubscriptionProviderUsage({
					authKind: "subscription",
					configured: true,
					id,
					managed: false,
				})
			).toBe(true);
		}
	});

	test("keeps pool, api-key, unconfigured, and unknown rows quiet", () => {
		for (const provider of [
			{
				authKind: "subscription",
				configured: true,
				id: "managed-openrouter",
				managed: true,
			},
			{
				authKind: "api-key",
				configured: true,
				id: "openai",
				managed: false,
			},
			{
				authKind: "subscription",
				configured: false,
				id: "claude-pro-max",
				managed: false,
			},
			{
				authKind: "subscription",
				configured: true,
				id: "unknown-subscription",
				managed: false,
			},
		]) {
			expect(supportsSubscriptionProviderUsage(provider)).toBe(false);
		}
	});

	test("uses the same engine hints as ACP usage polling", () => {
		expect(supportsUsage("acp:claude")).toBe(true);
		expect(supportsUsage("acp:codex")).toBe(true);
		expect(supportsUsage("acp:copilot")).toBe(true);
		expect(supportsUsage("ryu")).toBe(false);
	});
});
