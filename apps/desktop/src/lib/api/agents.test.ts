import { describe, expect, test } from "bun:test";
import { type AgentInput, fetchAgent, toAgentBody } from "./agents.ts";

describe("agent setup model slot wire format", () => {
	test("sends the legacy fields and the authoritative chat model slot", () => {
		const input: AgentInput = {
			chatModel: {
				engine: "openrouter",
				modelId: "anthropic/claude-sonnet",
			},
			description: null,
			engine: "acp:pi",
			model: "anthropic/claude-sonnet",
			name: "Researcher",
			systemPrompt: "Be precise.",
			tools: ["*"],
		};

		expect(toAgentBody(input)).toMatchObject({
			chat_model: {
				engine: "openrouter",
				model_id: "anthropic/claude-sonnet",
			},
			engine: "acp:pi",
			model: "anthropic/claude-sonnet",
		});
	});

	test("sends a personality profile inside the agent persona slot", () => {
		const input: AgentInput = {
			description: null,
			engine: "acp:pi",
			name: "ELI5 helper",
			persona: {
				display_name: "Aria",
				output_style_id: "eli5",
				tone: null,
			},
			systemPrompt: "Explain things clearly.",
			tools: ["*"],
		};

		expect(toAgentBody(input).persona).toMatchObject({
			output_style_id: "eli5",
		});
	});

	test("keeps the runtime engine separate from the chat provider slot", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			Response.json({
				agent: {
					chat_model: {
						engine: "openrouter",
						model_id: "openai/gpt-5-mini",
					},
					engine: "acp:pi",
					id: "researcher",
					name: "Researcher",
					persona: {
						display_name: null,
						output_style_id: "eli5",
						tone: null,
					},
				},
			})) as unknown as typeof globalThis.fetch;
		try {
			const agent = await fetchAgent(
				{ token: null, url: "http://127.0.0.1:7980" },
				"researcher"
			);
			expect(agent.engine).toBe("acp:pi");
			expect(agent.chatModel).toEqual({
				engine: "openrouter",
				modelId: "openai/gpt-5-mini",
			});
			expect(agent.persona?.output_style_id).toBe("eli5");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
