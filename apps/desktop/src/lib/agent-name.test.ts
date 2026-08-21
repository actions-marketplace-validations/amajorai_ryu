import { describe, expect, it } from "bun:test";
import {
	buildAgentNamePrompt,
	extractGeneratedAgentName,
	pickCommonAgentName,
} from "./agent-name.ts";

describe("agent name helpers", () => {
	it("picks a common name and avoids the current name", () => {
		expect(pickCommonAgentName("Alex", 0)).toBe("Amelia");
		expect(pickCommonAgentName("Alex", 0.99)).toBe("William");
	});

	it("normalizes a labelled model response", () => {
		expect(extractGeneratedAgentName('Name: "Maya".')).toBe("Maya");
		expect(extractGeneratedAgentName("```text\nElena\n```")).toBe("Elena");
		expect(extractGeneratedAgentName("Here are three names")).toBeNull();
	});

	it("includes the configured context in the generation prompt", () => {
		const prompt = buildAgentNamePrompt({
			instructions: "Review pull requests",
			title: "CTO",
		});
		expect(prompt).toContain("Role badge: CTO");
		expect(prompt).toContain("Instructions: Review pull requests");
	});
});
