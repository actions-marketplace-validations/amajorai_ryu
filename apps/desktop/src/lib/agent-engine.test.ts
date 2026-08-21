import { describe, expect, test } from "bun:test";
import {
	agentEngineOptionId,
	agentIdForEngine,
	engineForAgentSelection,
} from "@/src/lib/agent-engine.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
	return {
		avatarUrl: null,
		avatarGlyph: null,
		builtIn: true,
		createdAt: null,
		description: null,
		engine: null,
		id: "ryu",
		installed: true,
		lifecycleStatus: "active",
		installHint: null,
		latestVersion: null,
		locked: false,
		model: null,
		name: "Ryu",
		recommended: true,
		safetyProfile: "autonomous",
		systemPrompt: null,
		title: "",
		transport: "acp",
		version: null,
		versionStatus: null,
		...overrides,
	};
}

describe("agent engine mapping", () => {
	test("maps the flagship agent to its ACP engine id", () => {
		expect(agentEngineOptionId(agent())).toBe("acp:pi");
	});

	test("round-trips engine selections to agent ids", () => {
		const agents = [
			agent(),
			agent({
				builtIn: true,
				id: "acp:claude",
				name: "Claude Code",
				recommended: false,
			}),
		];
		expect(agentIdForEngine("acp:pi", agents)).toBe("ryu");
		expect(agentIdForEngine("acp:claude", agents)).toBe("acp:claude");
	});

	test("uses a custom agent engine when it has one", () => {
		const custom = agent({
			builtIn: false,
			engine: "acp:custom",
			id: "custom-agent",
			name: "Custom",
			recommended: false,
			transport: null,
		});
		expect(engineForAgentSelection(custom)).toBe("acp:custom");
		expect(agentIdForEngine("acp:custom", [custom])).toBe("custom-agent");
	});
});
