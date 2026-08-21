import { cn } from "@ryu/ui/lib/utils.ts";
import {
	IconBrandGithub,
	IconCircleCheck,
	IconCircleX,
	IconGitMerge,
	IconGitPullRequest,
	IconGitPullRequestClosed,
	IconGitPullRequestDraft,
	IconLoader2,
	IconMessageCircle,
	IconMinus,
} from "@tabler/icons-react";
import {
	checkBucket,
	failingPullRequestChecks,
	type GitPullRequest,
	type GitPullRequestStatus,
	gitPullRequestStatus,
	gitPullRequestStatusLabel,
	type PullRequestCheck,
	pullRequestHasMergeConflicts,
} from "@/src/lib/api/pull-requests.ts";

export function GitPullRequestStatusIcon({
	pullRequest,
}: {
	pullRequest: GitPullRequest;
}) {
	const status = gitPullRequestStatus(pullRequest);
	const label = gitPullRequestStatusLabel(status);
	const className = cn("size-4 shrink-0", statusColorClass(status));
	const Icon = statusIcon(status);
	return (
		<span
			aria-label={label}
			className="inline-flex shrink-0"
			data-status={status}
			data-testid={`pull-request-status-icon-${pullRequest.number}`}
			role="img"
			title={label}
		>
			<Icon aria-hidden className={className} />
		</span>
	);
}

function statusIcon(status: GitPullRequestStatus) {
	if (status === "merged") {
		return IconGitMerge;
	}
	if (status === "closed") {
		return IconGitPullRequestClosed;
	}
	if (status === "draft") {
		return IconGitPullRequestDraft;
	}
	return IconGitPullRequest;
}

function statusColorClass(status: GitPullRequestStatus): string {
	if (status === "merged") {
		return "text-[#8250df] dark:text-[#a371f7]";
	}
	if (status === "closed") {
		return "text-[#cf222e] dark:text-[#f85149]";
	}
	if (status === "draft") {
		return "text-[#656d76] dark:text-[#8b949e]";
	}
	return "text-[#1f883d] dark:text-[#3fb950]";
}

function CheckIcon({ check }: { check: PullRequestCheck }) {
	const bucket = checkBucket(check);
	if (bucket === "pass") {
		return (
			<IconCircleCheck aria-hidden className="size-3.5 text-emerald-500" />
		);
	}
	if (bucket === "fail") {
		return <IconCircleX aria-hidden className="size-3.5 text-destructive" />;
	}
	if (bucket === "pending") {
		return (
			<IconLoader2
				aria-hidden
				className="size-3.5 animate-spin text-amber-500"
			/>
		);
	}
	return <IconMinus aria-hidden className="size-3.5 text-muted-foreground" />;
}

function checkLabel(check: PullRequestCheck): string {
	return check.name ?? check.workflowName ?? "Unnamed check";
}

function checkSummary(pullRequest: GitPullRequest): {
	failed: PullRequestCheck[];
	passed: number;
	pending: number;
} {
	let passed = 0;
	let pending = 0;
	for (const check of pullRequest.statusCheckRollup) {
		const bucket = checkBucket(check);
		if (bucket === "pass") {
			passed += 1;
		} else if (bucket === "pending") {
			pending += 1;
		}
	}
	return {
		failed: failingPullRequestChecks(pullRequest),
		passed,
		pending,
	};
}

export function GitPullRequestSummary({
	className,
	compact = false,
	onFix,
	onFixMergeConflicts,
	pullRequest,
	showStatusIcon = true,
}: {
	className?: string;
	compact?: boolean;
	onFix?: () => void;
	onFixMergeConflicts?: () => void;
	pullRequest: GitPullRequest;
	showStatusIcon?: boolean;
}) {
	const { failed, passed, pending } = checkSummary(pullRequest);
	const checkCount = pullRequest.statusCheckRollup.length;
	const hasMergeConflicts = pullRequestHasMergeConflicts(pullRequest);
	const ciLabel =
		failed.length > 0
			? `${failed.length} failing check${failed.length === 1 ? "" : "s"}`
			: pending > 0
				? `${pending} check${pending === 1 ? "" : "s"} running`
				: checkCount > 0
					? `${passed} check${passed === 1 ? "" : "s"} passed`
					: "No checks yet";
	const ciTone =
		failed.length > 0
			? "text-destructive"
			: pending > 0
				? "text-amber-600 dark:text-amber-400"
				: checkCount > 0
					? "text-emerald-600 dark:text-emerald-400"
					: "text-muted-foreground";

	return (
		<div
			className={cn("flex min-w-0 flex-col gap-1.5", className)}
			data-testid={`pull-request-summary-${pullRequest.number}`}
		>
			<a
				aria-label={`Open pull request: ${pullRequest.title}`}
				className="flex min-w-0 items-center gap-1.5 text-foreground transition-colors hover:text-primary"
				href={pullRequest.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{showStatusIcon ? (
					<GitPullRequestStatusIcon pullRequest={pullRequest} />
				) : (
					<IconBrandGithub aria-hidden className="size-4 shrink-0" />
				)}
				<span className="min-w-0 truncate font-medium">
					{pullRequest.title}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					#{pullRequest.number}
				</span>
			</a>
			<div className="flex min-w-0 items-center gap-1.5 text-xs">
				<span className="shrink-0 text-muted-foreground">CI</span>
				<span className={cn("min-w-0 truncate", ciTone)}>{ciLabel}</span>
				{onFix && failed.length > 0 ? (
					<button
						className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onFix();
						}}
						type="button"
					>
						Fix
					</button>
				) : null}
			</div>
			{hasMergeConflicts ? (
				<div
					className="flex min-w-0 items-center gap-1.5 text-xs"
					data-testid={`pull-request-merge-conflicts-${pullRequest.number}`}
				>
					<IconCircleX
						aria-hidden
						className="size-3.5 shrink-0 text-destructive"
					/>
					<span className="min-w-0 truncate text-muted-foreground">
						Merge conflicts
					</span>
					{onFixMergeConflicts ? (
						<button
							aria-label={`Fix merge conflicts in pull request #${pullRequest.number}`}
							className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onFixMergeConflicts();
							}}
							type="button"
						>
							Fix
						</button>
					) : null}
				</div>
			) : null}
			{pullRequest.commentsCount === null ? null : (
				<a
					aria-label={`Open ${pullRequest.commentsCount} comments on pull request`}
					className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
					href={pullRequest.url}
					rel="noopener noreferrer"
					target="_blank"
				>
					<IconMessageCircle aria-hidden className="size-3.5 shrink-0" />
					<span>
						{pullRequest.commentsCount} comment
						{pullRequest.commentsCount === 1 ? "" : "s"}
					</span>
				</a>
			)}
			{!compact && checkCount > 0 ? (
				<div className="flex flex-col gap-1 border-border/60 border-t pt-1.5">
					{pullRequest.statusCheckRollup.slice(0, 6).map((check, index) => (
						<div
							className="flex min-w-0 items-center gap-1.5 text-[11px]"
							key={`${checkLabel(check)}-${index}`}
						>
							<CheckIcon check={check} />
							<span className="min-w-0 truncate text-muted-foreground">
								{checkLabel(check)}
							</span>
						</div>
					))}
					{checkCount > 6 ? (
						<span className="text-[10px] text-muted-foreground">
							+{checkCount - 6} more checks
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}
