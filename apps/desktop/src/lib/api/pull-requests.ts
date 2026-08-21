import { ownAppRequest } from "./app-request.ts";
import type { ApiTarget } from "./client.ts";

export const PULL_REQUESTS_APP_ID = "@ryu/pull-requests";
export type GitPullRequestLookupState = "all" | "open";

export interface PullRequestCheck {
	bucket: string | null;
	conclusion: string | null;
	description: string | null;
	detailsUrl: string | null;
	name: string | null;
	state: string | null;
	status: string | null;
	workflowName: string | null;
}

export interface GitPullRequest {
	baseRefName: string | null;
	branch: string | null;
	commentsCount: number | null;
	headRefName: string | null;
	headRefOid: string | null;
	isDraft: boolean;
	mergeable: string | null;
	mergedAt: string | null;
	mergeStateStatus: string | null;
	number: number;
	repository: string | null;
	state: string | null;
	statusCheckRollup: PullRequestCheck[];
	title: string;
	updatedAt: string | null;
	url: string;
}

export type GitPullRequestStatus = "closed" | "draft" | "merged" | "open";

export function gitPullRequestStatus(
	pullRequest: Pick<GitPullRequest, "isDraft" | "mergedAt" | "state">
): GitPullRequestStatus {
	const state = pullRequest.state?.toLowerCase();
	if (pullRequest.mergedAt || state === "merged") {
		return "merged";
	}
	if (pullRequest.isDraft) {
		return "draft";
	}
	if (state === "closed") {
		return "closed";
	}
	return "open";
}

export function gitPullRequestStatusLabel(
	status: GitPullRequestStatus
): string {
	return `${status[0]?.toUpperCase() ?? ""}${status.slice(1)} pull request`;
}

const MAX_REPORT_CHARS = 12_000;

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: null;
}

function count(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function repositoryName(value: unknown): string | null {
	if (typeof value === "string") {
		return text(value);
	}
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const record = value as Record<string, unknown>;
	return text(record.nameWithOwner) ?? text(record.name);
}

function normalizeCheck(value: unknown): PullRequestCheck | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const record = value as Record<string, unknown>;
	return {
		bucket: text(record.bucket),
		conclusion: text(record.conclusion),
		description: text(record.description),
		detailsUrl: text(record.detailsUrl) ?? text(record.link),
		name: text(record.name),
		state: text(record.state),
		status: text(record.status),
		workflowName: text(record.workflowName) ?? text(record.workflow),
	};
}

/** Normalize the Pull Requests app response and Core's creation response into
 * one desktop contract. Keeping this at the boundary lets the sidebar, pinned
 * summary, and future surfaces consume the app-owned check rollup identically. */
export function normalizeGitPullRequest(value: unknown): GitPullRequest | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const url = text(record.url) ?? text(record.pr_url);
	const urlNumber = url?.match(/\/pulls?\/(\d+)(?:\/|$)/)?.[1];
	const rawNumber =
		number(record.number) ?? (urlNumber ? number(Number(urlNumber)) : null);
	const title = text(record.title);
	const commentsCount =
		count(record.commentsCount) ??
		count(record.comments_count) ??
		(Array.isArray(record.comments) ? record.comments.length : null);
	if (rawNumber === null || !url || !title) {
		return null;
	}
	const rawChecks = Array.isArray(record.statusCheckRollup)
		? record.statusCheckRollup
		: Array.isArray(record.status_check_rollup)
			? record.status_check_rollup
			: [];
	return {
		baseRefName: text(record.baseRefName) ?? text(record.base),
		branch: text(record.branch) ?? text(record.headRefName),
		commentsCount,
		headRefName: text(record.headRefName) ?? text(record.branch),
		headRefOid: text(record.headRefOid) ?? text(record.head_sha),
		isDraft: record.isDraft === true || record.is_draft === true,
		mergeStateStatus:
			text(record.mergeStateStatus) ?? text(record.merge_state_status),
		mergeable: text(record.mergeable),
		mergedAt: text(record.mergedAt) ?? text(record.merged_at),
		number: rawNumber,
		repository: repositoryName(record.repository) ?? text(record.repository),
		state: text(record.state),
		statusCheckRollup: rawChecks.flatMap((check) => {
			const normalized = normalizeCheck(check);
			return normalized ? [normalized] : [];
		}),
		title,
		updatedAt: text(record.updatedAt) ?? text(record.updated_at),
		url,
	};
}

/** GitHub reports merge conflicts as `CONFLICTING`/`DIRTY`; other blocked or
 * pending merge states are not conflicts and should not offer the conflict Fix
 * action. */
export function pullRequestHasMergeConflicts(
	pullRequest: Pick<GitPullRequest, "mergeStateStatus" | "mergeable">
): boolean {
	return [pullRequest.mergeable, pullRequest.mergeStateStatus].some((value) => {
		const normalized = value?.trim().toLowerCase();
		return normalized === "conflicting" || normalized === "dirty";
	});
}

export function checkBucket(
	check: PullRequestCheck
): "cancel" | "fail" | "pass" | "pending" | "skipping" {
	const bucket = check.bucket?.toLowerCase();
	if (bucket === "pass" || bucket === "success") {
		return "pass";
	}
	if (bucket === "fail" || bucket === "failure" || bucket === "error") {
		return "fail";
	}
	if (bucket === "cancel" || bucket === "cancelled") {
		return "cancel";
	}
	if (bucket === "skipping" || bucket === "skipped") {
		return "skipping";
	}
	const state = `${check.state ?? ""} ${check.status ?? ""}`.toLowerCase();
	if (state.includes("success") || state.includes("completed")) {
		return "pass";
	}
	if (state.includes("failure") || state.includes("error")) {
		return "fail";
	}
	return "pending";
}

export function failingPullRequestChecks(
	pullRequest: GitPullRequest
): PullRequestCheck[] {
	return pullRequest.statusCheckRollup.filter(
		(check) => checkBucket(check) === "fail"
	);
}

function reportLine(label: string, value: string | null): string {
	return `${label}: ${value ?? "unknown"}`;
}

/** Build a bounded, metadata-only report for the user-triggered Fix action. */
export function buildPullRequestCheckReport(
	pullRequest: GitPullRequest
): string {
	const failing = failingPullRequestChecks(pullRequest);
	const lines = [
		"Ryu CI failure report",
		"",
		reportLine("Pull request", `#${pullRequest.number} ${pullRequest.title}`),
		reportLine("URL", pullRequest.url),
		reportLine(
			"Comments",
			pullRequest.commentsCount === null
				? null
				: String(pullRequest.commentsCount)
		),
		reportLine("Repository", pullRequest.repository),
		reportLine("Branch", pullRequest.headRefName ?? pullRequest.branch),
		reportLine("Base", pullRequest.baseRefName),
		reportLine("Head SHA", pullRequest.headRefOid),
		`Failing checks: ${failing.length}`,
		"",
	];
	for (const [index, check] of failing.entries()) {
		lines.push(
			`${index + 1}. ${check.name ?? "Unnamed check"}`,
			`   Workflow: ${check.workflowName ?? "unknown"}`,
			`   Status: ${checkBucket(check)}${check.state ? ` (${check.state})` : ""}`,
			`   Conclusion: ${check.conclusion ?? "unknown"}`,
			`   Details: ${check.detailsUrl ?? "unknown"}`,
			`   Description: ${(check.description ?? "unknown").replace(/\s+/g, " ").slice(0, 800)}`,
			""
		);
	}
	if (failing.length === 0) {
		lines.push("No failing checks were reported by GitHub.");
	}
	return lines.join("\n").slice(0, MAX_REPORT_CHARS);
}

/** Build a bounded, metadata-only report for the user-triggered merge-conflict
 * Fix action. The report gives the next chat turn the branch and GitHub state,
 * without copying repository contents or credentials into the composer. */
export function buildPullRequestMergeConflictReport(
	pullRequest: GitPullRequest
): string {
	const lines = [
		"Ryu merge conflict report",
		"",
		reportLine("Pull request", `#${pullRequest.number} ${pullRequest.title}`),
		reportLine("URL", pullRequest.url),
		reportLine("Repository", pullRequest.repository),
		reportLine("Branch", pullRequest.headRefName ?? pullRequest.branch),
		reportLine("Base", pullRequest.baseRefName),
		reportLine("Head SHA", pullRequest.headRefOid),
		reportLine("Mergeable", pullRequest.mergeable),
		reportLine("Merge state", pullRequest.mergeStateStatus),
		"",
		"GitHub reports merge conflicts for this pull request.",
		"Inspect the local project, resolve the conflicts, and verify the result before committing.",
	];
	return lines.join("\n").slice(0, MAX_REPORT_CHARS);
}

export async function fetchPullRequestForBranch(
	target: ApiTarget,
	cwd: string,
	branch: string,
	signal?: AbortSignal,
	state: GitPullRequestLookupState = "open"
): Promise<GitPullRequest | null> {
	const params = new URLSearchParams({ branch, cwd, state });
	const response = await ownAppRequest(target, PULL_REQUESTS_APP_ID, {
		path: `/pulls/branch?${params.toString()}`,
		signal,
	});
	if (typeof response !== "object" || response === null) {
		return null;
	}
	return normalizeGitPullRequest((response as { pull?: unknown }).pull);
}
