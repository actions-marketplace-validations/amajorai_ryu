// Builds the grouped, filtered candidate list for the composer "@" menu. The
// workflow group is the chat-workflow integration seam: only workflows the
// caller puts in `sources.workflows` (Core's chat-triggerable subset) appear,
// and picking one sets a `workflow` target on the tab. See
// docs/rfc-mention-composer.md.

import { describe, expect, test } from "bun:test";
import {
	applyMention,
	buildMentionGroups,
	resolveReferencedChatIds,
} from "./candidates.ts";
import type { MentionSources } from "./types.ts";

function sources(): MentionSources {
	return {
		agents: [{ id: "ryu", name: "Ryu" }],
		apps: [],
		chats: [
			{
				id: "conv-architecture",
				name: "Architecture notes",
				description: "Discussed the storage boundary",
			},
		],
		folders: [],
		mcp: [],
		plugins: [],
		skills: [],
		spaces: [],
		teams: [],
		workflows: [
			{
				id: "wf_plan",
				name: "Plan → Implement → Verify",
				description: "3-step pipeline",
			},
			{ id: "wf_simple", name: "Summarize", description: null },
		],
	};
}

describe("buildMentionGroups", () => {
	test("offers chat-triggerable workflows as a labelled group", () => {
		const groups = buildMentionGroups(sources(), "");
		const workflows = groups.find((g) => g.kind === "workflow");
		expect(workflows).toBeDefined();
		expect(workflows?.label).toBe("Workflows");
		expect(workflows?.items).toEqual([
			{
				kind: "workflow",
				id: "wf_plan",
				label: "Plan → Implement → Verify",
				description: "3-step pipeline",
				icon: expect.anything(),
			},
			{
				kind: "workflow",
				id: "wf_simple",
				label: "Summarize",
				description: undefined,
				icon: expect.anything(),
			},
		]);
	});

	test("filters workflows by name, case-insensitively", () => {
		const groups = buildMentionGroups(sources(), "summ");
		const workflows = groups.find((g) => g.kind === "workflow");
		expect(workflows?.items.map((i) => i.id)).toEqual(["wf_simple"]);
	});

	test("offers saved chats as reference mentions", () => {
		const groups = buildMentionGroups(sources(), "architecture");
		expect(groups.find((group) => group.kind === "chat")?.items).toEqual([
			{
				kind: "chat",
				id: "conv-architecture",
				label: "Architecture notes",
				description: "Discussed the storage boundary",
				icon: expect.anything(),
			},
		]);
	});

	test("hides the workflow group when no workflow sources are supplied", () => {
		const groups = buildMentionGroups(sources(), "");
		const without = { ...sources(), workflows: [] };
		const rebuilt = buildMentionGroups(without, "");
		expect(groups.find((g) => g.kind === "workflow")).toBeDefined();
		expect(rebuilt.find((g) => g.kind === "workflow")).toBeUndefined();
	});

	test("does not truncate installed apps or plugins", () => {
		const installed = Array.from({ length: 8 }, (_, index) => ({
			id: `installed-${index}`,
			name: `Installed ${index}`,
		}));
		const groups = buildMentionGroups(
			{ ...sources(), apps: installed, plugins: installed },
			""
		);

		expect(groups.find((group) => group.kind === "app")?.items).toHaveLength(8);
		expect(groups.find((group) => group.kind === "plugin")?.items).toHaveLength(
			8
		);
	});
});

describe("applyMention", () => {
	test("inserts an @Workflow token for a workflow item", () => {
		const value = "please @Plan";
		const item = {
			kind: "workflow" as const,
			id: "wf_plan",
			label: "Plan → Implement → Verify",
		};
		expect(applyMention(value, item)).toBe(
			"please @Plan → Implement → Verify "
		);
	});
});

describe("resolveReferencedChatIds", () => {
	test("resolves typed chat mentions and ignores removed selections", () => {
		const chats = sources().chats;
		expect(
			resolveReferencedChatIds(
				"compare with @Architecture notes",
				chats,
				new Set()
			)
		).toEqual(["conv-architecture"]);
		expect(
			resolveReferencedChatIds("no reference now", chats, new Set(chats[0].id))
		).toEqual([]);
	});
});
