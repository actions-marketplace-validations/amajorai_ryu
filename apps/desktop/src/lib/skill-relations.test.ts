import { describe, expect, test } from "bun:test";
import type { InstalledSkill } from "./api/skills.ts";
import {
	buildSkillRelationGraph,
	filterSkillRelationGraph,
	type SkillRelationGraph,
} from "./skill-relations.ts";

function skill(
	id: string,
	enabled: boolean,
	allowedTools: string[],
	description: string | null = null
): InstalledSkill {
	return {
		allowedTools,
		description,
		enabled,
		id,
		name: id.replaceAll("-", " "),
	};
}

function graphSkills(
	graph: SkillRelationGraph,
	kind: "agent-skill" | "skill-tool"
) {
	return graph.edges.filter((edge) => edge.kind === kind);
}

function agentSkillEdges(graph: SkillRelationGraph, agentId: string): string[] {
	return graphSkills(graph, "agent-skill")
		.filter((edge) => edge.source === `agent:${agentId}`)
		.map((edge) => edge.target);
}

describe("skill relation graph model", () => {
	test("empty agent scope connects only enabled installed skills", () => {
		const graph = buildSkillRelationGraph({
			agents: [{ id: "ryu", name: "Ryu", skills: [] }],
			skills: [
				skill("research", true, ["browser.search"]),
				skill("drafts", false, []),
			],
			usage: new Map([["research", 14]]),
		});

		expect(agentSkillEdges(graph, "ryu")).toEqual(["skill:research"]);
		expect(
			graph.nodes.find((node) => node.id === "skill:research")?.usageCount
		).toBe(14);
	});

	test("none marker creates no agent edges", () => {
		const graph = buildSkillRelationGraph({
			agents: [{ id: "locked", name: "Locked", skills: ["__ryu_none__"] }],
			skills: [skill("research", true, [])],
			usage: new Map(),
		});

		expect(agentSkillEdges(graph, "locked")).toHaveLength(0);
	});

	test("allowlists intersect enabled skills and dedupe declared tools", () => {
		const graph = buildSkillRelationGraph({
			agents: [
				{ id: "writer", name: "Writer", skills: ["research", "missing"] },
			],
			skills: [skill("research", true, ["files.read", "files.read"])],
			usage: new Map(),
		});

		expect(agentSkillEdges(graph, "writer")).toEqual(["skill:research"]);
		expect(graphSkills(graph, "skill-tool")).toHaveLength(1);
	});

	test("missing scope is labeled all-enabled without dropping the agent", () => {
		const graph = buildSkillRelationGraph({
			agents: [
				{
					id: "unknown",
					name: "Unknown",
					scopeUnavailable: true,
					skills: null,
				},
			],
			skills: [skill("research", true, [])],
			usage: new Map(),
		});

		expect(graph.nodes.find((node) => node.id === "agent:unknown")?.scope).toBe(
			"all-enabled"
		);
		expect(
			graph.nodes.find((node) => node.id === "agent:unknown")?.scopeUnavailable
		).toBe(true);
	});

	test("search keeps matching nodes and their direct neighbors", () => {
		const graph = buildSkillRelationGraph({
			agents: [{ id: "writer", name: "Writer", skills: ["research"] }],
			skills: [skill("research", true, ["browser.search"])],
			usage: new Map(),
		});

		const filtered = filterSkillRelationGraph(graph, "browser");
		expect(filtered.nodes.map((node) => node.id)).toEqual([
			"skill:research",
			"tool:browser.search",
		]);
		expect(filtered.edges).toHaveLength(1);
	});
});
