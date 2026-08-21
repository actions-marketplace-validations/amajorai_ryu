import { describe, expect, it } from "bun:test";
import {
	buildGitGraphLogCommand,
	buildGitGraphRows,
	type GitGraphCommit,
	parseGitGraphBranches,
	parseGitGraphLog,
} from "./git-graph.ts";

const RS = "\x1e";

function commit(
	sha: string,
	parents: string[] = [],
	refs: string[] = []
): GitGraphCommit {
	return {
		author: "Ryu",
		date: "2m ago",
		parents,
		refs,
		sha,
		shortSha: sha.slice(0, 7),
		subject: `Commit ${sha}`,
	};
}

describe("git graph parsing", () => {
	it("parses commit records, refs, and tabbed subjects", () => {
		const output = `${RS}abc123\tabc123\tRyu\t2 minutes ago\tparent123\t (HEAD -> main, origin/main)\tAdd\tgraph`;

		expect(parseGitGraphLog(output)).toEqual([
			{
				author: "Ryu",
				date: "2 minutes ago",
				parents: ["parent123"],
				refs: ["main", "origin/main"],
				sha: "abc123",
				shortSha: "abc123",
				subject: "Add\tgraph",
			},
		]);
	});

	it("parses local refs and current-head markers", () => {
		expect(
			parseGitGraphBranches("*\tmain\tabc123\n \tfeature/ui\tdef456\n")
		).toEqual([
			{ current: true, name: "main", sha: "abc123" },
			{ current: false, name: "feature/ui", sha: "def456" },
		]);
	});
});

describe("git graph lanes", () => {
	it("keeps a merge commit in one lane and opens its second parent beside it", () => {
		const rows = buildGitGraphRows([
			commit("merge", ["main-parent", "feature-parent"], ["main"]),
			commit("main-parent", ["root"]),
			commit("feature-parent", ["root"], ["feature/ui"]),
			commit("root"),
		]);

		expect(rows[0]).toMatchObject({ lane: 0, parentLanes: [0, 1] });
		expect(rows[1]).toMatchObject({ lane: 0, parentLanes: [0] });
		expect(rows[2]).toMatchObject({ lane: 1, parentLanes: [0] });
	});
});

describe("git graph commands", () => {
	it("scopes to a safe branch ref", () => {
		expect(buildGitGraphLogCommand("feature/ui")).toContain(
			"git log feature/ui"
		);
	});

	it("falls back to all refs for unsafe input", () => {
		const command = buildGitGraphLogCommand("feature/ui; rm -rf /");
		expect(command).toContain("git log --all");
		expect(command).not.toContain("rm -rf");
	});
});
