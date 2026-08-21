import { describe, expect, test } from "bun:test";
import { buildNewAgentChatSeed } from "./agent-onboarding.ts";

describe("new agent chat onboarding", () => {
	test("builds a fresh chat seed for the created agent", () => {
		expect(buildNewAgentChatSeed("agent-7", "Orbit")).toEqual({
			forceNew: true,
			initialAgent: "agent-7",
			initialPrompt:
				"Introduce yourself to me as Orbit. Briefly explain what you can help with based on your setup, then ask what I would like to work on first. Keep the welcome concise and friendly.",
			initialSubmit: true,
			title: "Orbit chat",
		});
	});

	test("falls back to a useful prompt when the name is blank", () => {
		const seed = buildNewAgentChatSeed("agent-8", "  ");

		expect(seed.initialAgent).toBe("agent-8");
		expect(seed.initialPrompt).toContain("your new agent");
		expect(seed.title).toBe("your new agent chat");
	});
});
