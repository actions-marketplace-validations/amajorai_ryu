import { describe, expect, test } from "bun:test";
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { modelOptionsForCatalog } from "./model-agent-picker.tsx";

function catalog(): RyuCatalogSnapshot {
	return {
		agents: [],
		apiTypes: [],
		current: {
			provider: "gateway",
			providerRouting: {},
			routing: "gateway",
		},
		hookEvents: [],
		hooks: [],
		plugins: [],
		providers: [
			{
				api: "openai-responses",
				authKind: "subscription",
				configured: true,
				id: "chatgpt-subscription",
				label: "ChatGPT subscription",
				suggestedModels: ["gpt-5"],
			},
			{
				api: "openai-responses",
				authKind: "api-key",
				configured: true,
				id: "openai",
				label: "OpenAI",
				modelOverrides: { "gpt-5-mini": false },
				suggestedModels: ["gpt-5-mini"],
			},
			{
				api: "openai-completions",
				authKind: "api-key",
				configured: false,
				custom: true,
				id: "local-proxy",
				label: "Local proxy",
				suggestedModels: ["local-model"],
			},
		],
		thinkingLevels: [],
		version: 1,
	};
}

describe("modelOptionsForCatalog", () => {
	test("keeps subscription, disabled override, and unavailable BYOK metadata", () => {
		const options = modelOptionsForCatalog(catalog());

		expect(options).toEqual([
			expect.objectContaining({
				authLabel: "Subscription",
				disabled: false,
				modelId: "gpt-5",
				providerId: "chatgpt-subscription",
			}),
			expect.objectContaining({
				authLabel: "BYOK",
				disabled: true,
				modelId: "gpt-5-mini",
				providerId: "openai",
			}),
			expect.objectContaining({
				authLabel: "BYOK",
				disabled: true,
				modelId: "local-model",
				providerId: "local-proxy",
			}),
		]);
	});
});
