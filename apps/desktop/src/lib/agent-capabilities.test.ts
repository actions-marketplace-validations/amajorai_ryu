import { describe, expect, test } from "bun:test";
import {
	ALL_MCP_TOOLS,
	encodeSkillAllowlist,
	encodeToolAllowlist,
	hydrateSkillSelection,
	hydrateToolSelection,
	NO_AGENT_CAPABILITIES,
} from "./agent-capabilities.ts";

const skills = [
	{ enabled: true, id: "browser" },
	{ enabled: true, id: "writer" },
	{ enabled: false, id: "draft" },
];

describe("agent capability defaults", () => {
	test("new and legacy-empty agents hydrate with all available access", () => {
		expect(
			hydrateToolSelection([], ["browser.open", "files.read"], true)
		).toEqual(new Set(["browser.open", "files.read"]));
		expect(hydrateToolSelection([], ["browser.open"], false)).toEqual(
			new Set(["browser.open"])
		);
		expect(hydrateSkillSelection([], skills, true)).toEqual(
			new Set(["browser", "writer"])
		);
	});

	test("wildcard and no-capabilities states survive a round trip", () => {
		const tools = ["browser.open", "files.read"];
		expect(encodeToolAllowlist(tools, new Set(tools))).toEqual([ALL_MCP_TOOLS]);
		expect(encodeToolAllowlist(tools, new Set())).toEqual([
			NO_AGENT_CAPABILITIES,
		]);
		expect(encodeSkillAllowlist(skills, new Set())).toEqual([
			NO_AGENT_CAPABILITIES,
		]);
		expect(hydrateToolSelection([NO_AGENT_CAPABILITIES], tools, false)).toEqual(
			new Set()
		);
		expect(
			hydrateSkillSelection([NO_AGENT_CAPABILITIES], skills, false)
		).toEqual(new Set());
	});

	test("a custom subset stays a subset", () => {
		expect(encodeToolAllowlist(["a", "b"], new Set(["a"]))).toEqual(["a"]);
		expect(encodeSkillAllowlist(skills, new Set(["browser"]))).toEqual([
			"browser",
		]);
	});
});
