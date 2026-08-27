import { describe, expect, it } from "bun:test";
import type { GatewayGovernanceSnapshot } from "@/src/lib/api/governance.ts";
import {
	resolveGitSetting,
	resolveWorktreeSetting,
} from "./developer-settings.ts";

const snapshot: GatewayGovernanceSnapshot = {
	layers: [
		{
			revision: 1,
			scope: "node",
			values: {
				git: { createDraftPullRequests: true },
				worktrees: { autoDeleteLimit: 15 },
			},
			writable: true,
		},
		{
			revision: 2,
			scope: "organization",
			values: { git: { createDraftPullRequests: false } },
			writable: false,
		},
	],
	schemaVersion: 1,
};

describe("developer governance value resolution", () => {
	it("keeps an explicit organization false over the node default", () => {
		expect(resolveGitSetting(snapshot, "createDraftPullRequests")).toEqual({
			scope: "organization",
			value: false,
		});
	});

	it("inherits a worktree limit from the node", () => {
		expect(resolveWorktreeSetting(snapshot, "autoDeleteLimit")).toEqual({
			scope: "node",
			value: 15,
		});
	});
});
