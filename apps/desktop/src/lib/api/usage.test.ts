import { afterEach, describe, expect, test } from "bun:test";
import {
	fetchProviderAccountUsage,
	supportsSubscriptionProviderUsage,
	supportsUsage,
} from "./usage.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

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

	test("fetches one saved account without changing the active account", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (input) => {
			urls.push(String(input));
			return Response.json({
				agent_id: "claude-pro-max",
				available: true,
				engine: "claude",
				plan: "Max 20x",
				windows: [],
			});
		}) as typeof fetch;

		const snapshot = await fetchProviderAccountUsage(
			{ token: "node-token", url: "http://127.0.0.1:8980", userJwt: null },
			"claude-pro-max",
			"acct/work/account"
		);

		expect(snapshot).toMatchObject({
			agentId: "claude-pro-max",
			available: true,
			plan: "Max 20x",
		});
		expect(urls).toEqual([
			"http://127.0.0.1:8980/api/pi-config/providers/claude-pro-max/accounts/acct%2Fwork%2Faccount/usage",
		]);
	});
});
