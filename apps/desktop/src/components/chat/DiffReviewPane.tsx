// apps/desktop/src/components/chat/DiffReviewPane.tsx
//
// Displays the aggregate diff for a completed run (Unit U011/U012). Shows the
// per-file summary list alongside the full unified diff in a collapsible pane,
// plus Apply (merge) and Open PR buttons to land the changes.

import {
	Add01Icon,
	AlertCircleIcon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	CheckmarkCircle02Icon,
	FileCodeIcon,
	FolderOpenIcon,
	GitMergeIcon,
	InformationCircleIcon,
	Loading01Icon,
	MinusSignIcon,
	Search01Icon,
	Share08Icon,
	WorkflowCircle06Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useEffect, useMemo, useState } from "react";
import {
	invalidateGitStatus,
	invalidateWorktreeDiff,
	invalidateWorktreeStatus,
	useWorktreeDiff,
} from "@/src/hooks/useGitStatus.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import type { ApplyResult, FileSummary } from "@/src/lib/api/git.ts";
import { applyWorktree } from "@/src/lib/api/git.ts";

interface DiffReviewPaneProps {
	runId: string;
	target: ApiTarget;
}

// ── Line-level diff renderer ──────────────────────────────────────────────────

function DiffLine({ line, number }: { line: string; number: number }) {
	const isAdd = line.startsWith("+") && !line.startsWith("+++");
	const isDel = line.startsWith("-") && !line.startsWith("---");
	const isHunk = line.startsWith("@@");
	const isFilePath = line.startsWith("---") || line.startsWith("+++");

	let cls = "font-mono text-xs leading-6 whitespace-pre select-text";
	if (isAdd) {
		cls += " bg-emerald-500/[0.08] text-foreground";
	} else if (isDel) {
		cls += " bg-rose-500/[0.08] text-foreground";
	} else if (isHunk) {
		cls += " bg-blue-500/[0.08] text-blue-600 dark:text-blue-400";
	} else if (isFilePath) {
		cls += " text-muted-foreground";
	} else {
		cls += " text-foreground";
	}

	return (
		<div className={cn("grid grid-cols-[3rem_1fr]", cls)}>
			<span className="sticky left-0 border-border/50 border-r bg-inherit pr-2 text-right text-muted-foreground/45 tabular-nums">
				{number}
			</span>
			<span className="px-3">{line || " "}</span>
		</div>
	);
}

// ── Per-file summary row ──────────────────────────────────────────────────────

function FileSummaryRow({
	file,
	selected,
	onSelect,
}: {
	file: FileSummary;
	onSelect: () => void;
	selected: boolean;
}) {
	const filename = file.path.split("/").at(-1) ?? file.path;
	const kindLabel =
		file.kind === "added"
			? "A"
			: file.kind === "deleted"
				? "D"
				: file.kind === "renamed"
					? "R"
					: "M";
	const kindClass =
		file.kind === "added"
			? "text-success dark:text-success"
			: file.kind === "deleted"
				? "text-destructive dark:text-destructive"
				: "text-muted-foreground";

	return (
		<button
			className={cn(
				"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/50",
				selected && "bg-muted text-foreground"
			)}
			onClick={onSelect}
			type="button"
		>
			<span className={`w-3 shrink-0 font-bold font-mono ${kindClass}`}>
				{kindLabel}
			</span>
			<HugeiconsIcon
				aria-hidden
				className="size-3 shrink-0 text-muted-foreground"
				icon={FileCodeIcon}
			/>
			<Tooltip>
				<TooltipTrigger
					render={
						<span className="truncate font-mono text-foreground">
							{filename}
						</span>
					}
				/>
				<TooltipContent>{file.path}</TooltipContent>
			</Tooltip>
			{(file.additions > 0 || file.deletions > 0) && (
				<span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
					{file.additions > 0 && (
						<span className="flex items-center gap-0.5 text-success dark:text-success">
							<HugeiconsIcon
								aria-hidden
								className="size-2.5"
								icon={Add01Icon}
							/>
							{file.additions}
						</span>
					)}
					{file.deletions > 0 && (
						<span className="flex items-center gap-0.5 text-destructive dark:text-destructive">
							<HugeiconsIcon
								aria-hidden
								className="size-2.5"
								icon={MinusSignIcon}
							/>
							{file.deletions}
						</span>
					)}
				</span>
			)}
		</button>
	);
}

const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/gm;

/** Pull one file's patch out of a multi-file unified diff. */
function patchForFile(unifiedDiff: string, path: string): string {
	const matches = [...unifiedDiff.matchAll(DIFF_HEADER_RE)];
	if (matches.length === 0) {
		return unifiedDiff;
	}
	const matchIndex = matches.findIndex(
		(match) => match[1] === path || match[2] === path
	);
	if (matchIndex < 0) {
		return unifiedDiff;
	}
	const start = matches[matchIndex]?.index ?? 0;
	const end = matches[matchIndex + 1]?.index ?? unifiedDiff.length;
	return unifiedDiff.slice(start, end).trimEnd();
}

// ── Apply state ───────────────────────────────────────────────────────────────

type ApplyState =
	| { status: "idle" }
	| { status: "loading"; mode: "merge" | "pr" }
	| { status: "merged"; commit: string | null }
	| { status: "pr"; prUrl: string }
	| { status: "conflict"; conflictedFiles: string[] }
	| { status: "error"; message: string };

// ── Main pane ─────────────────────────────────────────────────────────────────

export function DiffReviewPane({ target, runId }: DiffReviewPaneProps) {
	// The shared query, not a one-shot fetch on mount: this pane used to show
	// whatever the diff was the first time it rendered, for as long as it stayed
	// mounted — including after the change had been committed outside the app.
	const diff = useWorktreeDiff(target, runId);
	const [expanded, setExpanded] = useState(true);
	const [applyState, setApplyState] = useState<ApplyState>({ status: "idle" });
	const [filter, setFilter] = useState("");
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const handleApply = async (mode: "merge" | "pr") => {
		setApplyState({ status: "loading", mode });
		try {
			const result: ApplyResult = await applyWorktree(target, runId, {
				mode,
				message: `Applied run ${runId}`,
			});
			if (result.success) {
				// Applying a worktree changes both the worktree and the repo it
				// merges into, so refresh every git surface rather than this pane.
				invalidateGitStatus();
				invalidateWorktreeStatus(runId);
				invalidateWorktreeDiff(runId);
				if (result.pr_url) {
					setApplyState({ status: "pr", prUrl: result.pr_url });
				} else {
					setApplyState({ status: "merged", commit: result.commit });
				}
			} else {
				setApplyState({
					status: "conflict",
					conflictedFiles: result.conflicted_files,
				});
			}
		} catch (err) {
			setApplyState({
				status: "error",
				message: err instanceof Error ? err.message : "apply failed",
			});
		}
	};

	useEffect(() => {
		if (
			diff.files.length > 0 &&
			!(selectedPath && diff.files.some((file) => file.path === selectedPath))
		) {
			setSelectedPath(diff.files[0]?.path ?? null);
		}
	}, [diff.files, selectedPath]);

	const visibleFiles = useMemo(() => {
		const query = filter.trim().toLowerCase();
		return query
			? diff.files.filter((file) => file.path.toLowerCase().includes(query))
			: diff.files;
	}, [diff.files, filter]);
	const selectedFile =
		diff.files.find((file) => file.path === selectedPath) ?? diff.files[0];
	const selectedPatch = selectedFile
		? patchForFile(diff.unified_diff, selectedFile.path)
		: diff.unified_diff;
	const diffLines = selectedPatch.split("\n");
	const totalAdditions = diff.files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = diff.files.reduce((sum, f) => sum + f.deletions, 0);

	const applied =
		applyState.status === "merged" ||
		applyState.status === "pr" ||
		applyState.status === "conflict";

	// Render nothing until the diff is fetched or when there are no changes. Keep
	// this after hooks so a live query changing state never changes hook order.
	if (!diff.has_changes) {
		return null;
	}

	return (
		<div className="@container overflow-hidden rounded-2xl border border-border/70 bg-background text-sm shadow-sm">
			<button
				aria-expanded={expanded}
				className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
				onClick={() => setExpanded((prev) => !prev)}
				type="button"
			>
				{expanded ? (
					<HugeiconsIcon
						aria-hidden
						className="size-3.5 shrink-0 text-muted-foreground"
						icon={ArrowDown01Icon}
					/>
				) : (
					<HugeiconsIcon
						aria-hidden
						className="size-3.5 shrink-0 text-muted-foreground"
						icon={ArrowRight01Icon}
					/>
				)}
				<HugeiconsIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
					icon={WorkflowCircle06Icon}
				/>
				<span className="font-medium text-sm">
					{diff.files.length} file{diff.files.length === 1 ? "" : "s"} changed
				</span>
				<span className="ml-auto flex items-center gap-2 text-muted-foreground text-xs">
					{totalAdditions > 0 && (
						<span className="text-success dark:text-success">
							+{totalAdditions}
						</span>
					)}
					{totalDeletions > 0 && (
						<span className="text-destructive dark:text-destructive">
							-{totalDeletions}
						</span>
					)}
				</span>
			</button>

			{expanded && (
				<div className="border-border border-t">
					<div className="m-3 flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/8 px-3 py-2.5 text-foreground/80 text-xs">
						<HugeiconsIcon
							aria-hidden
							className="size-4 shrink-0 text-blue-500"
							icon={InformationCircleIcon}
						/>
						<span className="min-w-0 flex-1">
							Reviewing one file at a time for a cleaner, faster diff.
						</span>
					</div>
					<div className="grid min-h-72 @4xl:grid-cols-[minmax(0,1fr)_15rem]">
						<div className="min-w-0 overflow-hidden border-border/60 @4xl:border-r">
							<div className="flex items-center gap-2 border-border/60 border-b px-3 py-2 text-xs">
								<HugeiconsIcon
									aria-hidden
									className="size-3.5 text-muted-foreground"
									icon={FileCodeIcon}
								/>
								<span className="min-w-0 flex-1 truncate font-mono">
									{selectedFile?.path ?? "Changes"}
								</span>
								{selectedFile && (
									<span className="flex shrink-0 gap-1.5 tabular-nums">
										<span className="text-success">
											+{selectedFile.additions}
										</span>
										<span className="text-destructive">
											-{selectedFile.deletions}
										</span>
									</span>
								)}
							</div>
							<div className="max-h-[34rem] overflow-auto bg-muted/10">
								{diffLines.map((line, idx) => (
									<DiffLine
										// The patch order is immutable for this render; duplicate lines need their position.
										key={`${idx}-${line}`}
										line={line}
										number={idx + 1}
									/>
								))}
							</div>
						</div>
						<aside className="border-border/60 border-t @4xl:border-t-0 bg-muted/10 p-2">
							<div className="relative mb-2">
								<HugeiconsIcon
									aria-hidden
									className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
									icon={Search01Icon}
								/>
								<input
									aria-label="Filter changed files"
									className="h-8 w-full rounded-lg border border-input bg-background pl-8 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
									onChange={(event) => setFilter(event.target.value)}
									placeholder="Filter files…"
									value={filter}
								/>
							</div>
							<div className="mb-1 flex items-center gap-2 px-2 py-1 text-muted-foreground text-xs">
								<HugeiconsIcon className="size-3.5" icon={FolderOpenIcon} />
								<span>Changed files</span>
								<span className="ml-auto tabular-nums">
									{visibleFiles.length}
								</span>
							</div>
							<div className="scroll-fade max-h-64 overflow-y-auto">
								{visibleFiles.map((file) => (
									<FileSummaryRow
										file={file}
										key={file.path}
										onSelect={() => setSelectedPath(file.path)}
										selected={file.path === selectedFile?.path}
									/>
								))}
								{visibleFiles.length === 0 && (
									<p className="px-2 py-4 text-center text-muted-foreground text-xs">
										No matching files
									</p>
								)}
							</div>
						</aside>
					</div>
				</div>
			)}

			{/* Apply / Open PR actions */}
			<div className="flex flex-col gap-1.5 border-border border-t px-4 py-3">
				{applyState.status === "idle" && (
					<div className="flex items-center gap-2">
						<button
							className="flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
							onClick={() => handleApply("merge")}
							type="button"
						>
							<HugeiconsIcon
								aria-hidden
								className="size-3"
								icon={GitMergeIcon}
							/>
							Apply (merge)
						</button>
						<button
							className="flex items-center gap-1.5 rounded px-2.5 py-1 font-medium text-xs transition-colors hover:bg-muted/30"
							onClick={() => handleApply("pr")}
							type="button"
						>
							<HugeiconsIcon
								aria-hidden
								className="size-3"
								icon={Share08Icon}
							/>
							Open PR
						</button>
					</div>
				)}

				{applyState.status === "loading" && (
					<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<HugeiconsIcon
							aria-hidden
							className="size-3 animate-spin"
							icon={Loading01Icon}
						/>
						{applyState.mode === "merge" ? "Merging…" : "Opening PR…"}
					</div>
				)}

				{applyState.status === "merged" && (
					<div className="flex items-center gap-1.5 text-success text-xs dark:text-success">
						<HugeiconsIcon
							aria-hidden
							className="size-3"
							icon={CheckmarkCircle02Icon}
						/>
						Merged
						{applyState.commit && (
							<span className="font-mono text-muted-foreground">
								{applyState.commit.slice(0, 8)}
							</span>
						)}
					</div>
				)}

				{applyState.status === "pr" && (
					<div className="flex items-center gap-1.5 text-xs">
						<HugeiconsIcon
							aria-hidden
							className="size-3 text-success dark:text-success"
							icon={CheckmarkCircle02Icon}
						/>
						<a
							className="truncate text-info underline underline-offset-2 dark:text-info"
							href={applyState.prUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							{applyState.prUrl}
						</a>
					</div>
				)}

				{applyState.status === "conflict" && (
					<div className="flex flex-col gap-1 text-xs">
						<div className="flex items-center gap-1.5 text-warning dark:text-warning">
							<HugeiconsIcon
								aria-hidden
								className="size-3"
								icon={AlertCircleIcon}
							/>
							Merge conflict — worktree cleaned up safely
						</div>
						{applyState.conflictedFiles.length > 0 && (
							<ul className="ml-4 list-disc font-mono text-muted-foreground">
								{applyState.conflictedFiles.map((f: string) => (
									<li key={f}>{f}</li>
								))}
							</ul>
						)}
					</div>
				)}

				{applyState.status === "error" && (
					<div className="flex items-center gap-1.5 text-destructive text-xs dark:text-destructive">
						<HugeiconsIcon
							aria-hidden
							className="size-3"
							icon={AlertCircleIcon}
						/>
						{applyState.message}
						{!applied && (
							<button
								className="ml-1 underline underline-offset-2"
								onClick={() => setApplyState({ status: "idle" })}
								type="button"
							>
								Retry
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
