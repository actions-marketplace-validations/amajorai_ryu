// apps/desktop/src/components/panels/PinnedSummaryPanel.tsx
//
// The "Pinned summary" panel: a connected accordion rail shown once a
// conversation has a thread. The rail owns one rounded surface and uses subtle
// dividers between its sections instead of stacking unrelated cards. The first row is
// "Environment" (project ▸ branch ▸ worktree + live git +added/−removed line
// counts + a commit/push chooser); the rest (Progress / Artifacts /
// Changes / Sources / Side chats) come from the shared CoworkContextPanel and
// only appear when they have something to show.
//
// The Environment row is ALWAYS present — including with no project folder open,
// where it collapses to the project picker plus a one-line hint. It used to be
// gated on `folder`, which left a folderless chat with zero accordion items: the
// panel then rendered nothing while its docked column still reserved its width,
// so the sidebar read as a blank strip.
// Placement is owned by WorkspacePanels: normally a docked column stacked with
// the right panel (both push the chat narrower, both can be open at once); when
// the chat would get too narrow it auto-demotes to a floating overlay. Only the
// floating overlay passes `onDismiss` — the docked column never self-dismisses.

import {
	ArrowUpRight01Icon,
	CloudUploadIcon,
	ComputerTerminal01Icon,
	FolderLibraryIcon,
	GitCommitIcon,
	Loading01Icon,
	SentIcon,
	StopIcon,
	Tick02Icon,
	WorkflowCircle06Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import { Checkbox } from "@ryu/ui/components/checkbox.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { cn } from "@ryu/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	DiffStat,
	WorkspacePicker,
} from "@/src/components/chat/WorkspacePicker.tsx";
import type { CoworkContextPanelProps } from "@/src/components/panels/CoworkContextPanel.tsx";
import { CoworkContextPanel } from "@/src/components/panels/CoworkContextPanel.tsx";
import type { BouncyAccordionItem } from "@/src/components/ui/bouncy-accordion.tsx";
import { invalidateGitStatus, useGitStatus } from "@/src/hooks/useGitStatus.ts";
import {
	listBackgroundProcesses,
	requestStopBackgroundProcess,
	type BackgroundProcess,
} from "@/src/lib/api/background-processes.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	commitPush,
	type GitCommitAction,
	type GitStatus,
} from "@/src/lib/api/git.ts";

interface PinnedSummaryPanelProps {
	conversationId?: string | null;
	/**
	 * The Cowork context (Progress / Artifacts / Changes / Sources / Side chats)
	 * rendered below the Environment row — the same content as the right panel's
	 * Context tab, merged into this accordion.
	 */
	cowork: CoworkContextPanelProps;
	folder: string | null;
	/**
	 * Called when the panel should hide itself because the user pressed away
	 * from it. Only passed in floating-overlay mode (where the panel overlaps
	 * the message column); the docked column never self-dismisses.
	 */
	onDismiss?: () => void;
	target: ApiTarget;
}

type CommitState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "done"; label: string }
	| { status: "error"; message: string };

function formatBackgroundElapsed(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

function BackgroundProcessRow({
	process,
	stopping,
	onStop,
}: {
	onStop: (processId: string) => void;
	process: BackgroundProcess;
	stopping: boolean;
}) {
	const label = process.label?.trim() || process.command;
	return (
		<div className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-muted/50">
			<span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
				<HugeiconsIcon
					aria-hidden
					className="size-3.5"
					icon={ComputerTerminal01Icon}
				/>
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate" title={process.command}>
					{label}
				</span>
				<span className="block truncate text-[10px] text-muted-foreground">
					{process.cwd} · {formatBackgroundElapsed(process.elapsed_ms)}
				</span>
			</span>
			<button
				aria-label={`Stop ${label}`}
				className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 disabled:cursor-wait disabled:opacity-100"
				disabled={stopping}
				onClick={(event) => {
					event.stopPropagation();
					onStop(process.process_id);
				}}
			title={stopping ? "Stopping…" : "Stop process"}
			type="button"
			>
				<HugeiconsIcon
					aria-hidden
					className={cn("size-3.5", stopping && "animate-pulse")}
					icon={StopIcon}
				/>
			</button>
		</div>
	);
}

/** The Environment row body: pickers + git line-stats + commit/push dialog. */
function EnvironmentDescription({
	conversationId,
	target,
	folder,
	git,
	commit,
	hasWork,
	onOpenCommit,
}: {
	commit: CommitState;
	conversationId?: string | null;
	folder: string | null;
	git: GitStatus | null;
	hasWork: boolean;
	onOpenCommit: () => void;
	target: ApiTarget;
}) {
	const insertions = git?.insertions ?? 0;
	const deletions = git?.deletions ?? 0;
	const ahead = git?.ahead ?? 0;
	const clean = insertions === 0 && deletions === 0;

	// No folder: the branch and run-mode rows and every git affordance render
	// nothing, so the row shows just the folder picker and says why it is bare.
	if (!folder) {
		return (
			<div className="flex flex-col gap-2">
				<WorkspacePicker
					conversationId={conversationId}
					stacked
					target={target}
				/>
				<p className="text-muted-foreground text-xs">
					No project folder. Pick one to see branch, changes and commit.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{/* Project ▸ branch ▸ run mode — the SAME picker the composer's workspace
			    bar renders, in its `stacked` variant: three full-width rows rather
			    than one inline chip, because this column is 288px wide. The panel
			    used to mount three separate picker components here, which is how the
			    two families drifted; it now owns no picker markup of its own. */}
			<WorkspacePicker
				conversationId={conversationId}
				stacked
				target={target}
			/>

			{!git && (
				<p className="text-muted-foreground text-xs">Not a git repository.</p>
			)}
			{/* The +added/−removed counts already live in the accordion header, so the
			    body only carries what the header can't: the clean-tree state and any
			    unpushed-commit count. When the tree is dirty with nothing ahead, the
			    header alone says it all and this line is dropped. */}
			{git && (clean || ahead > 0) && (
				<div className="flex items-center gap-2 text-muted-foreground text-xs">
					<HugeiconsIcon
						aria-hidden
						className="size-3.5 shrink-0"
						icon={WorkflowCircle06Icon}
					/>
					{clean && (
						<span className="min-w-0 flex-1 truncate">
							No uncommitted changes
						</span>
					)}
					{ahead > 0 && (
						<span className="flex shrink-0 items-center gap-0.5 tabular-nums">
							<HugeiconsIcon
								aria-hidden
								className="size-3"
								icon={ArrowUpRight01Icon}
							/>
							{ahead}
						</span>
					)}
				</div>
			)}

			{git && (
				<button
					className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 font-medium text-primary-foreground text-xs transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={commit.status === "loading" || !hasWork}
					onClick={onOpenCommit}
					type="button"
				>
					<HugeiconsIcon
						aria-hidden
						className={cn(
							"size-3.5",
							commit.status === "loading" && "animate-spin"
						)}
						icon={commit.status === "loading" ? Loading01Icon : SentIcon}
					/>
					{commit.status === "loading" ? "Working…" : "Commit or push"}
				</button>
			)}

			{commit.status === "done" && (
				<p className="flex items-center gap-1 text-emerald-600 text-xs dark:text-emerald-400">
					<HugeiconsIcon aria-hidden className="size-3.5" icon={Tick02Icon} />
					{commit.label}
				</p>
			)}
			{commit.status === "error" && (
				<p className="break-words text-destructive text-xs">{commit.message}</p>
			)}
		</div>
	);
}

const COMMIT_ACTIONS: {
	action: GitCommitAction;
	description: string;
	icon: typeof GitCommitIcon;
	label: string;
}[] = [
	{
		action: "commit",
		label: "Commit",
		description: "Save changes locally",
		icon: GitCommitIcon,
	},
	{
		action: "commit-push",
		label: "Commit and push",
		description: "Save changes and update the remote",
		icon: CloudUploadIcon,
	},
	{
		action: "push",
		label: "Push",
		description: "Send existing commits to the remote",
		icon: SentIcon,
	},
];

export function PinnedSummaryPanel({
	conversationId,
	folder,
	target,
	cowork,
	onDismiss,
}: PinnedSummaryPanelProps) {
	const [commit, setCommit] = useState<CommitState>({ status: "idle" });
	const [commitDialogOpen, setCommitDialogOpen] = useState(false);
	const [commitMessage, setCommitMessage] = useState("");
	const [includeUnstaged, setIncludeUnstaged] = useState(true);

	// In floating-overlay mode (onDismiss set) the panel overlaps the message
	// column, so it behaves like a dismissible popover: a pointer press anywhere
	// outside it hides it, and the titlebar toggle brings it back. In docked
	// mode onDismiss is absent and no listener is bound.
	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!onDismiss) {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const pressed = event.target as HTMLElement | null;
			if (!pressed) {
				return;
			}
			// Ignore presses inside the panel, or inside a menu/popover/dialog the
			// pickers portal to the body root (project ▸ branch ▸ run mode) — those
			// live outside the panel's DOM subtree but are logically part of it.
			// The selector matches what the UI kit actually emits: these are Base UI
			// popups (`data-slot="…-content"`), never Radix — the old
			// `[data-radix-popper-content-wrapper]` probe could not match anything in
			// this app, so choosing a branch while the panel floated dismissed it.
			if (
				panelRef.current?.contains(pressed) ||
				pressed.closest(
					'[data-slot="dropdown-menu-content"],[data-slot="popover-content"],[data-slot="dialog-content"]'
				)
			) {
				return;
			}
			onDismiss();
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [onDismiss]);

	const targetRef = useRef(target);
	targetRef.current = target;

	const [stoppingProcessId, setStoppingProcessId] = useState<string | null>(
		null
	);
	const [backgroundError, setBackgroundError] = useState<string | null>(null);
	const backgroundProcessesQuery = useQuery({
		enabled: Boolean(target.url),
		queryFn: () => listBackgroundProcesses(target),
		queryKey: ["background-processes", target.url],
		refetchInterval: 1000,
		retry: false,
		staleTime: 0,
	});
	const backgroundProcesses = backgroundProcessesQuery.data ?? [];

	const handleStopBackgroundProcess = async (processId: string) => {
		if (stoppingProcessId) {
			return;
		}
		setBackgroundError(null);
		setStoppingProcessId(processId);
		try {
			await requestStopBackgroundProcess(targetRef.current, processId);
			await backgroundProcessesQuery.refetch();
		} catch (error) {
			setBackgroundError(
				error instanceof Error ? error.message : "Could not stop process."
			);
		} finally {
			setStoppingProcessId(null);
		}
	};

	// Shared with every other git surface, so this panel's counts can never
	// disagree with the branch pill above it.
	const { status: gitStatus } = useGitStatus(target, folder);
	const git = gitStatus.is_repo ? gitStatus : null;

	// An agent run mutates the tree, so re-read the moment it goes idle instead
	// of waiting out the poll interval.
	const chatStatus = cowork.chatStatus;
	useEffect(() => {
		if (folder && chatStatus !== "streaming" && chatStatus !== "submitted") {
			invalidateGitStatus(folder);
		}
	}, [chatStatus, folder]);

	const handleCommitPush = async (action: GitCommitAction) => {
		if (!folder || commit.status === "loading") {
			return;
		}
		setCommit({ status: "loading" });
		const result = await commitPush(
			targetRef.current,
			folder,
			commitMessage.trim() || undefined,
			undefined,
			action,
			includeUnstaged
		);
		if (result.success) {
			const label =
				action === "commit"
					? `Committed ${result.commit ?? "changes"}`
					: result.committed
						? `Pushed ${result.commit ?? "commit"}`
						: "Push complete";
			setCommit({ status: "done", label });
			setCommitDialogOpen(false);
			setCommitMessage("");
			// Everything on screen just changed, not only this panel.
			invalidateGitStatus(folder);
		} else {
			setCommit({
				status: "error",
				message: result.error ?? "commit/push failed",
			});
		}
	};

	const changedCount = git?.changed_files_count ?? 0;
	const insertions = git?.insertions ?? 0;
	const deletions = git?.deletions ?? 0;
	const ahead = git?.ahead ?? 0;
	// A push is worth doing when there are local changes or unpushed commits.
	const hasWork = changedCount > 0 || ahead > 0;

	const backgroundItem: BouncyAccordionItem | null =
		backgroundProcesses.length === 0
			? null
			: {
					id: "background-processes",
					icon: (
						<HugeiconsIcon
							aria-hidden
							className="size-4"
							icon={ComputerTerminal01Icon}
						/>
					),
					title: (
						<span className="flex items-center gap-2">
							<span className="font-medium text-foreground text-xs">
								Background processes
							</span>
							<span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">
								{backgroundProcesses.length}
							</span>
						</span>
					),
					description: (
						<div className="flex flex-col gap-1">
							{backgroundProcesses.map((process) => (
								<BackgroundProcessRow
									key={process.process_id}
									onStop={(processId) => {
										void handleStopBackgroundProcess(processId);
									}}
									process={process}
									stopping={stoppingProcessId === process.process_id}
								/>
							))}
							{backgroundError && (
								<p className="px-1.5 text-destructive text-[10px]">
									{backgroundError}
								</p>
							)}
						</div>
					),
				};

	// The Environment row: pickers + git line-stats + commit & push. Always
	// present — with no folder it degrades to the project picker + a hint, which
	// keeps the panel from collapsing to nothing (see the file header).
	const environmentItem: BouncyAccordionItem = {
		id: "environment",
		icon: (
			<HugeiconsIcon aria-hidden className="size-4" icon={FolderLibraryIcon} />
		),
		title: (
			<span className="flex items-center gap-2">
				<span className="font-medium text-foreground text-xs">Environment</span>
				{git && <DiffStat stat={{ insertions, deletions }} />}
			</span>
		),
		description: (
			<EnvironmentDescription
				commit={commit}
				conversationId={conversationId}
				folder={folder}
				git={git}
				hasWork={hasWork}
				onOpenCommit={() => setCommitDialogOpen(true)}
				target={target}
			/>
		),
	};

	return (
		// Floating overlay caps its own height and scrolls; the docked column's
		// wrapper is full-height and owns scrolling, so no cap there.
		<div
			className={cn(
				"pointer-events-auto w-72",
				onDismiss && "max-h-[70vh] overflow-y-auto"
			)}
			ref={panelRef}
		>
			<CoworkContextPanel
				{...cowork}
				leadingItems={[
					environmentItem,
					...(backgroundItem ? [backgroundItem] : []),
				]}
				maxItemsPerSection={5}
				variant="summary"
			/>
			<Dialog onOpenChange={setCommitDialogOpen} open={commitDialogOpen}>
				<DialogContent
					className="gap-0 overflow-hidden border border-border/70 bg-popover/95 p-0 shadow-2xl sm:max-w-xl"
					showCloseButton={false}
				>
					<DialogHeader className="border-border/60 border-b px-6 pt-5 pb-4">
						<DialogTitle className="flex items-center gap-2 text-lg">
							<HugeiconsIcon className="size-5" icon={WorkflowCircle06Icon} />
							{git?.branch ?? "Repository"}
						</DialogTitle>
						<DialogDescription>
							Choose what to do with the current changes.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4 px-6 py-5">
						<label className="flex flex-col gap-2">
							<span className="font-medium text-xs">Commit message</span>
							<textarea
								className="min-h-24 w-full resize-none rounded-xl border border-input bg-background/60 px-3 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
								disabled={commit.status === "loading"}
								onChange={(event) => setCommitMessage(event.target.value)}
								placeholder="Leave blank to generate a commit message…"
								value={commitMessage}
							/>
						</label>
						<label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1 text-sm">
							<Checkbox
								checked={includeUnstaged}
								disabled={commit.status === "loading"}
								onCheckedChange={(checked) =>
									setIncludeUnstaged(checked === true)
								}
							/>
							<span className="min-w-0 flex-1">Include unstaged changes</span>
							<DiffStat stat={{ insertions, deletions }} />
						</label>
						{commit.status === "error" && (
							<p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-xs">
								{commit.message}
							</p>
						)}
					</div>
					<div className="border-border/60 border-t p-2">
						{COMMIT_ACTIONS.map((item) => (
							<Button
								className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/60"
								disabled={commit.status === "loading"}
								key={item.action}
								onClick={() => handleCommitPush(item.action)}
								type="button"
								variant="ghost"
							>
								<span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
									<HugeiconsIcon
										className={cn(
											"size-4",
											commit.status === "loading" && "animate-pulse"
										)}
										icon={item.icon}
									/>
								</span>
								<span className="flex min-w-0 flex-col">
									<span className="font-medium text-sm">{item.label}</span>
									<span className="font-normal text-muted-foreground text-xs">
										{item.description}
									</span>
								</span>
							</Button>
						))}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
