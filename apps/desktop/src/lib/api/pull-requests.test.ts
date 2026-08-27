import { describe, expect, test } from "bun:test";
import {
	buildGitHubCompareUrl,
	buildPullRequestCheckReport,
	buildPullRequestMergeConflictReport,
	checkBucket,
	failingPullRequestChecks,
	gitPullRequestStatus,
	normalizeGitHubRepository,
	normalizeGitPullRequest,
	pullRequestHasMergeConflicts,
	selectGitHubCompareBaseBranch,
} from "./pull-requests.ts";

const pullRequest = normalizeGitPullRequest({
	baseRefName: "main",
	headRefName: "codex/ci",
	headRefOid: "abc123",
	commentsCount: 3,
	number: 42,
	repository: { nameWithOwner: "openai/codex" },
	statusCheckRollup: [
		{
			bucket: "pass",
			name: "Type-check",
		},
		{
			bucket: "fail",
			conclusion: "failure",
			description: "Lint failed",
			detailsUrl: "https://github.com/check/1",
			name: "Lint",
			workflowName: "CI",
		},
	],
	title: "Fix CI",
	url: "https://github.com/openai/codex/pull/42",
});

describe("Pull Requests app contract", () => {
	test("preserves normalized and legacy default-branch response shapes", () => {
		expect(
			normalizeGitHubRepository({
				defaultBranch: "develop",
				nameWithOwner: "amajorai/ryu",
				url: "https://github.com/amajorai/ryu",
			})?.defaultBranch
		).toBe("develop");
		expect(
			normalizeGitHubRepository({
				defaultBranchRef: { name: "trunk" },
				nameWithOwner: "amajorai/ryu",
				url: "https://github.com/amajorai/ryu",
			})?.defaultBranch
		).toBe("trunk");
	});

	test("builds a safe compare URL and omits same-branch comparisons", () => {
		const repository = {
			defaultBranch: "main",
			nameWithOwner: "amajorai/ryu",
			url: "https://github.com/amajorai/ryu",
		};
		expect(buildGitHubCompareUrl(repository, "feature/ui", "main")).toBe(
			"https://github.com/amajorai/ryu/compare/main...feature%2Fui?expand=1"
		);
		expect(buildGitHubCompareUrl(repository, "main", "main")).toBeNull();
	});

	test("selects the configured compare base before local defaults", () => {
		expect(selectGitHubCompareBaseBranch("release", "master", [])).toBe(
			"release"
		);
		expect(selectGitHubCompareBaseBranch(null, "master", ["main"])).toBe(
			"master"
		);
		expect(selectGitHubCompareBaseBranch(null, null, ["master"])).toBe(
			"master"
		);
		expect(selectGitHubCompareBaseBranch(null, null, [])).toBe("main");
	});

	test("normalizes app metadata and identifies failing checks", () => {
		expect(pullRequest).not.toBeNull();
		expect(pullRequest?.repository).toBe("openai/codex");
		expect(pullRequest?.commentsCount).toBe(3);
		expect(pullRequest?.statusCheckRollup).toHaveLength(2);
		expect(
			checkBucket(
				pullRequest?.statusCheckRollup[1] ?? {
					bucket: null,
					conclusion: null,
					description: null,
					detailsUrl: null,
					name: null,
					state: null,
					status: null,
					workflowName: null,
				}
			)
		).toBe("fail");
		expect(
			failingPullRequestChecks(pullRequest as NonNullable<typeof pullRequest>)
		).toHaveLength(1);
		const fallback = normalizeGitPullRequest({
			pr_url: "https://github.com/openai/codex/pull/552",
			title: "Fix CI",
		});
		expect(fallback?.number).toBe(552);
	});

	test("maps GitHub pull request states to the shared status set", () => {
		expect(
			gitPullRequestStatus({ isDraft: false, mergedAt: null, state: "OPEN" })
		).toBe("open");
		expect(
			gitPullRequestStatus({ isDraft: true, mergedAt: null, state: "OPEN" })
		).toBe("draft");
		expect(
			gitPullRequestStatus({ isDraft: false, mergedAt: null, state: "CLOSED" })
		).toBe("closed");
		expect(
			gitPullRequestStatus({
				isDraft: false,
				mergedAt: "2026-08-19T10:00:00Z",
				state: "CLOSED",
			})
		).toBe("merged");
	});

	test("detects merge conflicts without treating other merge blocks as conflicts", () => {
		const conflicting = normalizeGitPullRequest({
			mergeStateStatus: "DIRTY",
			mergeable: "CONFLICTING",
			number: 43,
			title: "Resolve branch drift",
			url: "https://github.com/openai/codex/pull/43",
		});
		const blocked = normalizeGitPullRequest({
			mergeStateStatus: "BLOCKED",
			mergeable: "MERGEABLE",
			number: 44,
			title: "Wait for review",
			url: "https://github.com/openai/codex/pull/44",
		});

		expect(conflicting).not.toBeNull();
		expect(
			pullRequestHasMergeConflicts(
				conflicting as NonNullable<typeof conflicting>
			)
		).toBe(true);
		expect(
			pullRequestHasMergeConflicts(blocked as NonNullable<typeof blocked>)
		).toBe(false);
		expect(
			buildPullRequestMergeConflictReport(
				conflicting as NonNullable<typeof conflicting>
			)
		).toContain("Merge state: DIRTY");
	});

	test("builds a bounded text report with failing check context", () => {
		const report = buildPullRequestCheckReport(
			pullRequest as NonNullable<typeof pullRequest>
		);
		expect(report).toContain("#42 Fix CI");
		expect(report).toContain("Lint");
		expect(report).toContain("https://github.com/check/1");
		expect(report).toContain("Comments: 3");
		expect(report.length).toBeLessThanOrEqual(12_000);
	});
});
