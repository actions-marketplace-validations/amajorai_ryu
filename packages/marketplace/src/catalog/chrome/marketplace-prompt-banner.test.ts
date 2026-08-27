import { describe, expect, test } from "bun:test";
import { resolveMarketplacePromptColors } from "./marketplace-prompt-banner.tsx";

describe("resolveMarketplacePromptColors", () => {
	test("uses manifest colors before the id-derived fallback", () => {
		expect(
			resolveMarketplacePromptColors(
				"com.example.app",
				{ colors: ["#101828", "#6d5dfc", "#2dd4bf"] },
				true
			)
		).toEqual(["#101828", "#6d5dfc", "#101828", "#2dd4bf"]);
	});

	test("accepts a single simple manifest background as the accent", () => {
		expect(
			resolveMarketplacePromptColors(
				"com.example.app",
				{ background: "#ef8354" },
				false
			)
		).toEqual(["#ef8354", "#ef8354", "#ef8354", "#ef8354"]);
	});

	test("falls back to a deterministic waitlist-style warp palette", () => {
		const first = resolveMarketplacePromptColors("com.example.app", null, true);
		const second = resolveMarketplacePromptColors(
			"com.example.app",
			null,
			true
		);

		expect(first).toEqual(second);
		expect(first[0]).toBe("#121212");
		expect(
			resolveMarketplacePromptColors("com.example.app", null, false)[0]
		).toBe("#f2f2f4");
	});

	test("drops unsafe or non-colour manifest values", () => {
		const colors = resolveMarketplacePromptColors(
			"com.example.app",
			{
				background: "url(https://tracker.invalid/pixel)",
				colors: ["linear-gradient(red, blue)", "#2dd4bf"],
			},
			true
		);

		expect(colors[0]).not.toContain("url(");
		expect(colors).not.toContain("linear-gradient(red, blue)");
		expect(colors[1]).not.toContain("url(");
	});
});
