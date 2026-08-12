// apps/desktop/src/hooks/useGitStatus.ts
//
// The single source of truth for "what does git say about this folder" in the
// desktop. Every surface that shows a branch, a dirty dot, or a +/− count reads
// it from here, so they can never disagree with each other.
//
// Before this hook each consumer (WorkspaceHeader, WorkspacePicker,
// WorktreePicker, PinnedSummaryPanel) called `fetchGitStatus` from its own
// effect on its own schedule: two of them polled every 5s from independently
// started timers, two fetched exactly once and then never again. That is why the
// numbers drifted — not because any one of them was wrong, but because they were
// each right about a different moment.
//
// The cache key is the working directory, canonicalised. Branch is *output*, not
// part of the key: keying on folder+branch would mint a fresh entry on every
// checkout and leave the old one behind, still holding the numbers from before
// the switch. A git worktree is not a third axis either — it is simply a
// different working directory, so `~/proj` and `~/proj/.claude/worktrees/foo`
// are two keys, which is correct.

import { useQuery } from "@tanstack/react-query";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchGitStatus,
	fetchWorktreeStatus,
	type GitStatus,
	type WorktreeStatus,
} from "@/src/lib/api/git.ts";
import { queryClient } from "@/src/lib/query-client.ts";

/** How often the shared query re-reads git. One timer for the whole app. */
const POLL_INTERVAL_MS = 5000;

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

const TRAILING_SEPARATORS = /[\\/]+$/;

/**
 * Canonical form of a workspace path, so `/repo` and `/repo/` share one cache
 * entry instead of polling git twice and rendering two different answers.
 */
export function canonicalCwd(cwd: string): string {
	const trimmed = cwd.trim().replace(TRAILING_SEPARATORS, "");
	return trimmed === "" ? cwd.trim() : trimmed;
}

/** The shared query key. Exported so callers can invalidate without guessing. */
export function gitStatusKey(cwd: string | null): [string, string] {
	return ["git-status", cwd ? canonicalCwd(cwd) : ""];
}

/**
 * Live git status for `cwd`, shared across every component that asks for the
 * same folder: TanStack Query dedupes concurrent mounts onto one in-flight
 * request and one poll timer, and hands them all the identical object.
 *
 * Returns the non-repo shape (rather than `undefined`) while loading or when the
 * folder is not a repo, so callers can render `status.is_repo` directly.
 */
export function useGitStatus(
	target: ApiTarget,
	cwd: string | null
): { isLoading: boolean; status: GitStatus } {
	const { data, isLoading } = useQuery({
		queryKey: gitStatusKey(cwd),
		queryFn: ({ signal }) =>
			fetchGitStatus(target, canonicalCwd(cwd ?? ""), signal),
		enabled: Boolean(cwd),
		refetchInterval: POLL_INTERVAL_MS,
		// The point of this hook is freshness, so opt out of the app-wide
		// 5-minute staleTime that suits slow-moving catalog data.
		staleTime: 0,
		gcTime: 60_000,
	});

	return { status: data ?? NOT_REPO, isLoading: isLoading && Boolean(cwd) };
}

/**
 * Force every mounted consumer to re-read git for `cwd` now.
 *
 * Call this straight after any action that changes the tree — checkout, branch
 * create, commit/push, worktree apply — instead of refreshing only the component
 * that performed it. That local-refresh-only habit is what left the other panels
 * showing pre-commit numbers until their own timer happened to fire.
 *
 * Pass no argument to refresh every folder (useful when the change could have
 * touched a worktree as well as its parent repo).
 */
export function invalidateGitStatus(cwd?: string | null): void {
	queryClient.invalidateQueries({
		queryKey: cwd ? gitStatusKey(cwd) : ["git-status"],
	});
}

// ── Per-conversation worktree status ─────────────────────────────────────────
//
// Same problem, same shape: WorktreePicker and WorkspacePicker each polled
// `/api/worktree/:run_id/status` on their own timer. Keyed by conversation id
// because that is what the endpoint is keyed by.

const NO_WORKTREE: WorktreeStatus = {
	active: false,
	branch: null,
	path: null,
	has_changes: false,
	changed_files: 0,
};

/** The shared worktree query key. */
export function worktreeStatusKey(
	conversationId: string | null | undefined
): [string, string] {
	return ["worktree-status", conversationId ?? ""];
}

/**
 * Live worktree status for a conversation, shared across every consumer the same
 * way {@link useGitStatus} shares repo status.
 */
export function useWorktreeStatus(
	target: ApiTarget,
	conversationId: string | null | undefined
): WorktreeStatus {
	const { data } = useQuery({
		queryKey: worktreeStatusKey(conversationId),
		queryFn: ({ signal }) =>
			fetchWorktreeStatus(target, conversationId ?? "", signal),
		enabled: Boolean(conversationId),
		refetchInterval: POLL_INTERVAL_MS,
		staleTime: 0,
		gcTime: 60_000,
	});

	return data ?? NO_WORKTREE;
}

/** Force a re-read of one conversation's worktree status (or all of them). */
export function invalidateWorktreeStatus(conversationId?: string | null): void {
	queryClient.invalidateQueries({
		queryKey: conversationId
			? worktreeStatusKey(conversationId)
			: ["worktree-status"],
	});
}
