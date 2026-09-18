import { useQuery } from "@tanstack/react-query";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchPullRequestForBranch,
	type GitPullRequest,
	type GitPullRequestLookupState,
} from "@/src/lib/api/pull-requests.ts";
import { queryClient } from "@/src/lib/query-client.ts";
import { canonicalCwd } from "./useGitStatus.ts";

const POLL_INTERVAL_MS = 30_000;
const FRESH_MS = 10_000;

function gitPullRequestKeyPrefix(
	cwd: string | null,
	branch: string | null
): [string, string, string] {
	return [
		"git-pull-request",
		cwd ? canonicalCwd(cwd) : "",
		branch?.trim() ?? "",
	];
}

export function gitPullRequestKey(
	cwd: string | null,
	branch: string | null,
	state: GitPullRequestLookupState = "open"
): [string, string, string, GitPullRequestLookupState] {
	return [...gitPullRequestKeyPrefix(cwd, branch), state];
}

/** Read the PR owned by the current branch through the optional Pull Requests
 * app. A disabled/unavailable app is treated as no metadata, so local Git
 * actions remain usable without turning the Environment row into an error. */
export function useGitPullRequest(
	target: ApiTarget,
	cwd: string | null,
	branch: string | null,
	enabled: boolean,
	state: GitPullRequestLookupState = "open"
): { data: GitPullRequest | null; isLoading: boolean } {
	const normalizedBranch = branch?.trim() || null;
	const observing = enabled && Boolean(cwd && normalizedBranch);
	const { data, isLoading } = useQuery({
		queryKey: [
			...gitPullRequestKey(cwd, normalizedBranch, state),
			target.url,
			target.token ?? null,
			target.userJwt ?? null,
		],
		queryFn: ({ signal }) =>
			fetchPullRequestForBranch(
				target,
				canonicalCwd(cwd ?? ""),
				normalizedBranch ?? "",
				signal,
				state
			).catch(() => null),
		enabled: observing,
		subscribed: observing,
		gcTime: 60_000,
		refetchInterval: POLL_INTERVAL_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		staleTime: FRESH_MS,
	});

	return { data: data ?? null, isLoading };
}

export function invalidateGitPullRequest(
	cwd?: string | null,
	branch?: string | null
): void {
	queryClient.invalidateQueries({
		queryKey:
			cwd && branch
				? gitPullRequestKeyPrefix(cwd, branch)
				: ["git-pull-request"],
	});
}
