// apps/desktop/src/lib/api/git.ts
//
// Typed client for Core's git endpoints:
//   - `GET /api/git/status?cwd=<path>` (consumed by WorkspacePicker)
//   - `POST /api/git/init` (consumed by Ryu Work's non-repo entry point)
//   - `POST /api/git/pull` and `/api/git/sync` (consumed by PinnedSummaryPanel)
//   - `GET /api/worktree/:run_id/diff` (consumed by DiffReviewPane)
//   - `POST /api/worktree/:run_id/apply` (consumed by DiffReviewPane)

import type { FileEditUndoPlan } from "@ryu/blocks/desktop/agent-elements/turn-end-cards";
import {
	type ApiTarget,
	apiUrl,
	authenticatedFetch,
	makeHeaders,
	readJsonBody,
} from "./client.ts";

export interface GitFileDiffResult {
	patch: string;
	paths: string[];
}

export type ReverseEditsConflictReason =
	| "changed_since_turn"
	| "staged_changes"
	| "unsupported_file";

export type ReverseEditsResult =
	| { kind: "applied"; paths: string[] }
	| {
			kind: "conflict";
			paths: string[];
			reason: ReverseEditsConflictReason;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

function parseFileDiff(value: unknown): GitFileDiffResult | undefined {
	if (!isRecord(value) || typeof value.patch !== "string") {
		return undefined;
	}
	const paths = stringArray(value.paths);
	return paths ? { patch: value.patch, paths } : undefined;
}

function parseReverseEditsResult(
	value: unknown
): ReverseEditsResult | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const paths = stringArray(value.paths);
	if (!paths) {
		return undefined;
	}
	if (value.kind === "applied") {
		return { kind: "applied", paths };
	}
	if (
		value.kind === "conflict" &&
		(value.reason === "changed_since_turn" ||
			value.reason === "staged_changes" ||
			value.reason === "unsupported_file")
	) {
		return { kind: "conflict", paths, reason: value.reason };
	}
	return undefined;
}

export async function fetchGitFileDiff(
	target: ApiTarget,
	cwd: string,
	paths: string[],
	signal?: AbortSignal
): Promise<GitFileDiffResult> {
	const response = await fetch(apiUrl(target, "/api/git/file-diff"), {
		body: JSON.stringify({ cwd, paths }),
		headers: makeHeaders(target.token, target.userJwt),
		method: "POST",
		signal,
	});
	const { data, error } = await readJsonBody<unknown>(response, "file diff");
	if (error) {
		throw new Error(error);
	}
	const parsed = parseFileDiff(data);
	if (!parsed) {
		throw new Error("invalid file diff response");
	}
	return parsed;
}

export async function reverseGitEdits(
	target: ApiTarget,
	cwd: string,
	plan: FileEditUndoPlan,
	signal?: AbortSignal
): Promise<ReverseEditsResult> {
	const response = await fetch(apiUrl(target, "/api/git/reverse-edits"), {
		body: JSON.stringify({ cwd, plan }),
		headers: makeHeaders(target.token, target.userJwt),
		method: "POST",
		signal,
	});
	const { data, error, status } = await readJsonBody<unknown>(
		response,
		"reverse edits"
	);
	const parsed = parseReverseEditsResult(data);
	if (status === 409 && parsed?.kind === "conflict") {
		return parsed;
	}
	if (error) {
		throw new Error(error);
	}
	if (parsed?.kind !== "applied") {
		throw new Error("invalid reverse edits response");
	}
	return parsed;
}

export interface GitStatus {
	ahead: number;
	behind: number;
	branch: string | null;
	changed_files_count: number;
	deletions: number;
	dirty: boolean;
	insertions: number;
	is_repo: boolean;
}

const NOT_REPO: GitStatus = {
	is_repo: false,
	branch: null,
	ahead: 0,
	behind: 0,
	dirty: false,
	changed_files_count: 0,
	insertions: 0,
	deletions: 0,
};

export interface GitInitResult {
	branch?: string | null;
	error?: string;
	initialized?: boolean;
	success: boolean;
}

/** Initialize a local repository without staging or committing its files. */
export async function initializeGit(
	target: ApiTarget,
	cwd: string,
	signal?: AbortSignal
): Promise<GitInitResult> {
	try {
		const resp = await authenticatedFetch(target, "/api/git/init", {
			method: "POST",
			body: JSON.stringify({ cwd }),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<GitInitResult>>(
			resp,
			"git init"
		);
		if (error) {
			return { success: false, error };
		}
		return {
			branch: data?.branch ?? null,
			initialized: data?.initialized ?? false,
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "git init failed",
		};
	}
}

/**
 * Fetch git status for `cwd` from Core. Returns `{is_repo:false}` when the
 * folder is not a git repo or when Core is unreachable — callers should treat
 * any non-repo result as "hide the header" rather than an error.
 */
export async function fetchGitStatus(
	target: ApiTarget,
	cwd: string,
	signal?: AbortSignal
): Promise<GitStatus> {
	const path = `/api/git/status?cwd=${encodeURIComponent(cwd)}`;
	try {
		const resp = await authenticatedFetch(target, path, {
			method: "GET",
			signal,
		});
		if (!resp.ok) {
			return NOT_REPO;
		}
		const json = (await resp.json()) as Partial<GitStatus>;
		return {
			is_repo: json.is_repo ?? false,
			branch: json.branch ?? null,
			ahead: json.ahead ?? 0,
			behind: json.behind ?? 0,
			dirty: json.dirty ?? false,
			changed_files_count: json.changed_files_count ?? 0,
			insertions: json.insertions ?? 0,
			deletions: json.deletions ?? 0,
		};
	} catch {
		return NOT_REPO;
	}
}

// ── Branch list + switch (composer branch selector) ──────────────────────────

export interface GitBranches {
	branches: string[];
	current: string | null;
	is_repo: boolean;
}

const NO_BRANCHES: GitBranches = {
	is_repo: false,
	current: null,
	branches: [],
};

/**
 * List local branches (plus the current one) for `cwd`. Returns an empty,
 * non-repo result when the folder is not a git repo or Core is unreachable, so
 * callers can treat any empty result as "nothing to switch."
 */
export async function fetchGitBranches(
	target: ApiTarget,
	cwd: string,
	signal?: AbortSignal
): Promise<GitBranches> {
	const path = `/api/git/branches?cwd=${encodeURIComponent(cwd)}`;
	try {
		const resp = await authenticatedFetch(target, path, {
			method: "GET",
			signal,
		});
		if (!resp.ok) {
			return NO_BRANCHES;
		}
		const json = (await resp.json()) as Partial<GitBranches>;
		return {
			is_repo: json.is_repo ?? false,
			current: json.current ?? null,
			branches: json.branches ?? [],
		};
	} catch {
		return NO_BRANCHES;
	}
}

export interface CheckoutResult {
	branch?: string;
	error?: string;
	success: boolean;
}

/**
 * Switch `cwd` to an existing local branch. Resolves with `{success:false,error}`
 * on a git failure (e.g. uncommitted changes that would be overwritten) so the
 * caller can surface the message rather than throw.
 */
export async function checkoutBranch(
	target: ApiTarget,
	cwd: string,
	branch: string,
	signal?: AbortSignal
): Promise<CheckoutResult> {
	try {
		const resp = await authenticatedFetch(target, "/api/git/checkout", {
			method: "POST",
			body: JSON.stringify({ cwd, branch }),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<CheckoutResult>>(
			resp,
			"checkout"
		);
		if (error) {
			return { success: false, error };
		}
		return { success: true, branch: data?.branch ?? branch };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : "checkout failed",
		};
	}
}

/**
 * Create a new branch off the current HEAD in `cwd` and switch to it
 * (`git switch -c`). Resolves with `{success:false,error}` on a git failure (e.g.
 * the branch already exists) so the caller can surface the message rather than
 * throw. The desktop only offers this when the working tree is clean.
 */
export async function createBranch(
	target: ApiTarget,
	cwd: string,
	branch: string,
	signal?: AbortSignal
): Promise<CheckoutResult> {
	try {
		const resp = await authenticatedFetch(target, "/api/git/create-branch", {
			method: "POST",
			body: JSON.stringify({ cwd, branch }),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<CheckoutResult>>(
			resp,
			"create branch"
		);
		if (error) {
			return { success: false, error };
		}
		return { success: true, branch: data?.branch ?? branch };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : "create branch failed",
		};
	}
}

// ── Commit + push (pinned-summary action) ────────────────────────────────────

export interface CommitPushResult {
	commit?: string | null;
	committed?: boolean;
	error?: string;
	pushed?: boolean;
	success: boolean;
}

export type GitCommitAction = "commit" | "commit-push" | "push";

/** GitHub PRs are offered only for a branch that can merge into a default branch. */
export function isPullRequestBranch(
	branch: string | null | undefined
): boolean {
	const normalized = branch?.trim().toLowerCase();
	return Boolean(
		normalized && normalized !== "main" && normalized !== "master"
	);
}

/**
 * Stage everything, commit with `message` (defaulting server-side to
 * "Update via Ryu"), and push to the tracking remote for `cwd`. Resolves with
 * `{success:false,error}` on any git failure (nothing-to-commit is not an error;
 * a missing upstream is) so the caller can surface the message rather than throw.
 */
export async function commitPush(
	target: ApiTarget,
	cwd: string,
	message?: string,
	signal?: AbortSignal,
	action: GitCommitAction = "commit-push",
	includeUnstaged = true
): Promise<CommitPushResult> {
	try {
		const resp = await authenticatedFetch(target, "/api/git/commit-push", {
			method: "POST",
			body: JSON.stringify({
				cwd,
				message,
				action,
				include_unstaged: includeUnstaged,
			}),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<CommitPushResult>>(
			resp,
			"commit/push"
		);
		if (error) {
			return { success: false, error };
		}
		return {
			success: true,
			committed: data?.committed ?? false,
			pushed: data?.pushed ?? false,
			commit: data?.commit ?? null,
		};
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : "commit/push failed",
		};
	}
}

export interface GitRemoteResult {
	commit?: string | null;
	error?: string;
	pulled?: boolean;
	pushed?: boolean;
	success: boolean;
}

export type GitRemoteAction = "pull" | "sync";

async function runGitRemoteAction(
	target: ApiTarget,
	cwd: string,
	action: GitRemoteAction,
	signal?: AbortSignal
): Promise<GitRemoteResult> {
	try {
		const resp = await authenticatedFetch(target, `/api/git/${action}`, {
			method: "POST",
			body: JSON.stringify({ cwd }),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<GitRemoteResult>>(
			resp,
			`git ${action}`
		);
		if (error) {
			return { success: false, error };
		}
		return {
			commit: data?.commit ?? null,
			pulled: data?.pulled ?? true,
			pushed: data?.pushed ?? action === "sync",
			success: true,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : `git ${action} failed`,
		};
	}
}

export function pullGit(
	target: ApiTarget,
	cwd: string,
	signal?: AbortSignal
): Promise<GitRemoteResult> {
	return runGitRemoteAction(target, cwd, "pull", signal);
}

export function syncGit(
	target: ApiTarget,
	cwd: string,
	signal?: AbortSignal
): Promise<GitRemoteResult> {
	return runGitRemoteAction(target, cwd, "sync", signal);
}

// ── Pull request creation (pinned-summary action) ───────────────────────────

export interface PullRequestOptions {
	base?: string;
	body?: string;
	draft: boolean;
	includeUnstaged: boolean;
	title?: string;
}

export interface PullRequestResult {
	already_exists?: boolean;
	base?: string | null;
	branch?: string | null;
	comments_count?: number | null;
	error?: string;
	head_sha?: string | null;
	is_draft?: boolean;
	number?: number | null;
	pr_url?: string | null;
	repository?: string | null;
	state?: string | null;
	success: boolean;
	title?: string | null;
}

/**
 * Optionally commit and push the current folder, then create a GitHub pull
 * request through Core's authenticated `gh` installation.
 */
export async function createPullRequest(
	target: ApiTarget,
	cwd: string,
	opts: PullRequestOptions,
	signal?: AbortSignal
): Promise<PullRequestResult> {
	try {
		const resp = await authenticatedFetch(target, "/api/git/pull-request", {
			method: "POST",
			body: JSON.stringify({
				base: opts.base,
				body: opts.body,
				cwd,
				draft: opts.draft,
				include_unstaged: opts.includeUnstaged,
				title: opts.title,
			}),
			signal,
		});
		const { data, error } = await readJsonBody<Partial<PullRequestResult>>(
			resp,
			"pull request"
		);
		if (error) {
			return { success: false, error };
		}
		return {
			already_exists: data?.already_exists ?? false,
			base: data?.base ?? null,
			branch: data?.branch ?? null,
			comments_count: data?.comments_count ?? null,
			head_sha: data?.head_sha ?? null,
			is_draft: data?.is_draft ?? opts.draft,
			number: data?.number ?? null,
			pr_url: data?.pr_url ?? null,
			repository: data?.repository ?? null,
			success: true,
			state: data?.state ?? null,
			title: data?.title ?? null,
		};
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : "pull request failed",
		};
	}
}

// ── Worktree diff (Unit U011) ─────────────────────────────────────────────────

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface FileSummary {
	additions: number;
	deletions: number;
	kind: FileChangeKind;
	path: string;
}

export interface WorktreeDiff {
	files: FileSummary[];
	has_changes: boolean;
	unified_diff: string;
}

const EMPTY_DIFF: WorktreeDiff = {
	has_changes: false,
	files: [],
	unified_diff: "",
};

// ── Worktree status (persistent-session presence) ─────────────────────────────

export interface WorktreeStatus {
	/** True when a live worktree is held for the conversation (iterable). */
	active: boolean;
	/** The worktree's branch (`ryu/...`), present while active. */
	branch: string | null;
	changed_files: number;
	has_changes: boolean;
	/** Absolute worktree path, present while active. */
	path: string | null;
}

const NO_WORKTREE: WorktreeStatus = {
	active: false,
	branch: null,
	path: null,
	has_changes: false,
	changed_files: 0,
};

/**
 * Read whether a conversation currently has a live persistent worktree. Returns
 * an inactive status when none exists yet (e.g. before the first message) or
 * when Core is unreachable, so callers treat it as "no worktree" not an error.
 *
 * `runId` is the conversation id (the worktree store is keyed by conversation).
 */
export async function fetchWorktreeStatus(
	target: ApiTarget,
	runId: string,
	signal?: AbortSignal
): Promise<WorktreeStatus> {
	try {
		const resp = await authenticatedFetch(
			target,
			`/api/worktree/${encodeURIComponent(runId)}/status`,
			{
				method: "GET",
				signal,
			}
		);
		if (!resp.ok) {
			return NO_WORKTREE;
		}
		const json = (await resp.json()) as Partial<WorktreeStatus>;
		return {
			active: json.active ?? false,
			branch: json.branch ?? null,
			path: json.path ?? null,
			has_changes: json.has_changes ?? false,
			changed_files: json.changed_files ?? 0,
		};
	} catch {
		return NO_WORKTREE;
	}
}

// ── Worktree apply (Unit U012) ────────────────────────────────────────────────

export type ApplyMode = "merge" | "pr";

export interface ApplyOptions {
	base?: string;
	message: string;
	mode: ApplyMode;
}

export interface ApplySuccess {
	commit: string | null;
	pr_url: string | null;
	success: true;
}

export interface ConflictError {
	conflicted_files: string[];
	error: "merge_conflict";
	success: false;
}

export type ApplyResult = ApplySuccess | ConflictError;

/**
 * Apply a completed run's changes: commit + merge into base (mode='merge') or
 * commit + push + open a PR (mode='pr'). Returns a conflict error (HTTP 409)
 * when the merge cannot complete cleanly — the worktree is still cleaned up.
 */
export async function applyWorktree(
	target: ApiTarget,
	runId: string,
	opts: ApplyOptions,
	signal?: AbortSignal
): Promise<ApplyResult> {
	const resp = await authenticatedFetch(
		target,
		`/api/worktree/${encodeURIComponent(runId)}/apply`,
		{
			method: "POST",
			body: JSON.stringify(opts),
			signal,
		}
	);
	// This one still THROWS on failure by contract (DiffReviewPane catches), but
	// the throw must carry the server's reason — never a raw `SyntaxError` from
	// parsing a text/plain rejection body.
	const { data, error, status } = await readJsonBody<Record<string, unknown>>(
		resp,
		"apply"
	);
	if (status === 409) {
		return {
			success: false,
			error: "merge_conflict",
			conflicted_files: (data?.conflicted_files as string[] | undefined) ?? [],
		};
	}
	if (error) {
		throw new Error(error);
	}
	return {
		success: true,
		commit: (data?.commit as string | null) ?? null,
		pr_url: (data?.pr_url as string | null) ?? null,
	};
}

/**
 * Fetch the aggregate diff for a run's worktree from Core.
 *
 * `runId` is the `conversation_id` that was active when the run executed with
 * worktree isolation enabled. Core stores the diff keyed by conversation id
 * after each ACP run completes.
 *
 * Returns an empty diff when no diff is found (e.g. the run did not use
 * worktree isolation, or the run has not completed yet).
 */
export async function fetchWorktreeDiff(
	target: ApiTarget,
	runId: string,
	signal?: AbortSignal
): Promise<WorktreeDiff> {
	try {
		const resp = await authenticatedFetch(
			target,
			`/api/worktree/${encodeURIComponent(runId)}/diff`,
			{
				method: "GET",
				signal,
			}
		);
		if (!resp.ok) {
			return EMPTY_DIFF;
		}
		const json = (await resp.json()) as Partial<WorktreeDiff>;
		return {
			has_changes: json.has_changes ?? false,
			files: json.files ?? [],
			unified_diff: json.unified_diff ?? "",
		};
	} catch {
		return EMPTY_DIFF;
	}
}
