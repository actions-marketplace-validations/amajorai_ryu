import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowUpRight01Icon,
	CloudUploadIcon,
	GitBranchIcon,
	GitCommitIcon,
	Globe02Icon,
	Loading01Icon,
	RefreshIcon,
	Share08Icon,
	SquareLock01Icon,
	StopIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, ButtonLabel } from "@ryu/ui/components/button.tsx";
import { Checkbox } from "@ryu/ui/components/checkbox.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { RadioGroup, RadioGroupItem } from "@ryu/ui/components/radio-group.tsx";
import { formatCount } from "@ryu/ui/lib/number-format.ts";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useState } from "react";
import type { GitCommitAction } from "@/src/lib/api/git.ts";
import type { GitHubRepositoryVisibility } from "@/src/lib/api/pull-requests.ts";

export type GitProgressPhase =
	| "generating"
	| "initializing"
	| "committing"
	| "pushing"
	| "pulling"
	| "syncing"
	| "creating"
	| "creating-repository";

export type PullRequestAction = "draft" | "create" | "open";

export function gitProgressLabel(phase: GitProgressPhase): string {
	switch (phase) {
		case "generating":
			return "Generating message…";
		case "initializing":
			return "Creating local Git…";
		case "committing":
			return "Committing…";
		case "pushing":
			return "Pushing…";
		case "pulling":
			return "Pulling…";
		case "syncing":
			return "Syncing…";
		case "creating":
			return "Creating pull request…";
		case "creating-repository":
			return "Creating GitHub repository…";
	}
}

export interface GitProgressStatusProps {
	onStop?: () => void;
	phase: GitProgressPhase;
}

export function GitProgressStatus({ onStop, phase }: GitProgressStatusProps) {
	return (
		<div
			aria-live="polite"
			className="flex w-full items-center gap-2 rounded-md bg-muted/70 px-2 py-1.5 text-xs"
			role="status"
		>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
				<HugeiconsIcon
					aria-hidden
					className="size-3.5 shrink-0 animate-spin"
					icon={Loading01Icon}
				/>
				{gitProgressLabel(phase)}
			</span>
			{onStop && (
				<button
					aria-label="Stop git action"
					className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onStop}
					title="Stop git action"
					type="button"
				>
					<HugeiconsIcon aria-hidden className="size-4" icon={StopIcon} />
				</button>
			)}
		</div>
	);
}

export function GitRemoteActions({
	onPull,
	onSync,
}: {
	onPull: () => void;
	onSync: () => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-1.5">
			<button
				aria-label="Pull latest changes"
				className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-border/70 px-2 py-1.5 font-medium text-muted-foreground text-xs transition hover:bg-muted/60 hover:text-foreground"
				onClick={onPull}
				title="Pull latest changes"
				type="button"
			>
				<HugeiconsIcon
					aria-hidden
					className="size-3.5 shrink-0"
					icon={ArrowDown01Icon}
				/>
				<span>Pull</span>
			</button>
			<button
				aria-label="Sync with remote"
				className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-border/70 px-2 py-1.5 font-medium text-muted-foreground text-xs transition hover:bg-muted/60 hover:text-foreground"
				onClick={onSync}
				title="Sync with remote"
				type="button"
			>
				<HugeiconsIcon
					aria-hidden
					className="size-3.5 shrink-0"
					icon={RefreshIcon}
				/>
				<span>Sync</span>
			</button>
		</div>
	);
}

export interface CreateGitHubRepositoryDialogProps {
	error?: string | null;
	name: string;
	onNameChange: (name: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: (visibility: GitHubRepositoryVisibility) => void;
	onVisibilityChange: (visibility: GitHubRepositoryVisibility) => void;
	open: boolean;
	progress?: GitProgressPhase;
	visibility: GitHubRepositoryVisibility;
}

/** Ask for the provider-facing repository identity only after local Git exists. */
export function CreateGitHubRepositoryDialog({
	error,
	name,
	onNameChange,
	onOpenChange,
	onSubmit,
	onVisibilityChange,
	open,
	progress,
	visibility,
}: CreateGitHubRepositoryDialogProps) {
	const busy = progress !== undefined;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="gap-0 rounded-[28px] border-border/80 bg-background/95 p-5 shadow-2xl backdrop-blur-xl sm:max-w-[520px]"
				data-testid="create-github-repository-dialog"
				showCloseButton={false}
			>
				<DialogHeader>
					<DialogTitle>Create GitHub repository</DialogTitle>
					<DialogDescription>
						Keep this folder local, or publish it to GitHub after the initial
						commit.
					</DialogDescription>
				</DialogHeader>
				<div className="mt-5 grid gap-2">
					<label
						className="font-medium text-sm"
						htmlFor="github-repository-name"
					>
						Repository name
					</label>
					<Input
						aria-label="GitHub repository name"
						disabled={busy}
						id="github-repository-name"
						onChange={(event) => onNameChange(event.target.value)}
						placeholder="my-project"
						value={name}
					/>
				</div>
				<fieldset className="mt-5 grid gap-2">
					<legend className="font-medium text-sm">Visibility</legend>
					<RadioGroup
						aria-label="Repository visibility"
						onValueChange={(value) => {
							if (value === "private" || value === "public") {
								onVisibilityChange(value);
							}
						}}
						value={visibility}
					>
						<label
							className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 px-3 py-3 transition-colors hover:bg-muted/60"
							htmlFor="github-repository-private"
						>
							<RadioGroupItem
								aria-label="Private repository"
								disabled={busy}
								id="github-repository-private"
								value="private"
							/>
							<HugeiconsIcon
								aria-hidden
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								icon={SquareLock01Icon}
							/>
							<span className="min-w-0">
								<span className="block font-medium text-sm">Private</span>
								<span className="block text-muted-foreground text-xs">
									Only you and collaborators can see it.
								</span>
							</span>
						</label>
						<label
							className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 px-3 py-3 transition-colors hover:bg-muted/60"
							htmlFor="github-repository-public"
						>
							<RadioGroupItem
								aria-label="Public repository"
								disabled={busy}
								id="github-repository-public"
								value="public"
							/>
							<HugeiconsIcon
								aria-hidden
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								icon={Globe02Icon}
							/>
							<span className="min-w-0">
								<span className="block font-medium text-sm">Public</span>
								<span className="block text-muted-foreground text-xs">
									Anyone can discover and clone it.
								</span>
							</span>
						</label>
					</RadioGroup>
				</fieldset>
				<p className="mt-4 text-muted-foreground text-xs leading-5">
					Ryu commits the local folder, creates the GitHub remote, and pushes
					the current branch. GitHub CLI handles your existing sign-in.
				</p>
				{error && (
					<p className="mt-3 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
						{error}
					</p>
				)}
				<div className="mt-5 flex justify-end gap-2">
					<Button
						disabled={busy}
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={busy || !name.trim()}
						onClick={() => onSubmit(visibility)}
						type="button"
					>
						{busy && progress ? gitProgressLabel(progress) : "Create and push"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function DialogDiffStats({
	deletions,
	insertions,
}: {
	deletions: number;
	insertions: number;
}) {
	if (insertions === 0 && deletions === 0) {
		return null;
	}
	return (
		<span className="flex shrink-0 items-center gap-2 font-medium font-mono text-2xl tabular-nums sm:text-[30px]">
			{insertions > 0 && (
				<span className="text-emerald-500">+{formatCount(insertions)}</span>
			)}
			{deletions > 0 && (
				<span className="text-red-500">−{formatCount(deletions)}</span>
			)}
		</span>
	);
}

interface BranchTargetPickerProps {
	branch: string;
	branches: string[];
	disabled: boolean;
	loading: boolean;
	onBranchMenuOpenChange: (open: boolean) => void;
	onCreateBranch?: (name: string) => Promise<string | null>;
	onSelectBranch: (branch: string) => void;
}

function BranchTargetPicker({
	branch,
	branches,
	disabled,
	loading,
	onBranchMenuOpenChange,
	onCreateBranch,
	onSelectBranch,
}: BranchTargetPickerProps) {
	const [newBranchOpen, setNewBranchOpen] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");
	const [newBranchError, setNewBranchError] = useState<string | null>(null);
	const branchOptions = [
		branch,
		...branches.filter((candidate) => candidate !== branch),
	].filter(Boolean);

	const handleCreateBranch = async () => {
		const name = newBranchName.trim();
		if (!(name && onCreateBranch)) {
			return;
		}
		setNewBranchError(null);
		const error = await onCreateBranch(name);
		if (error) {
			setNewBranchError(error);
			return;
		}
		setNewBranchName("");
		setNewBranchOpen(false);
	};

	return (
		<>
			<DropdownMenu onOpenChange={onBranchMenuOpenChange}>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Commit to ${branch}`}
							className="h-14 w-full justify-start gap-3 rounded-[22px] bg-muted/75 px-5 text-lg hover:bg-muted"
							disabled={disabled}
							type="button"
							variant="ghost"
						/>
					}
				>
					<HugeiconsIcon
						aria-hidden
						className="size-6 shrink-0"
						icon={GitBranchIcon}
					/>
					<ButtonLabel className="min-w-0 flex-1 truncate text-left font-normal">
						{branch}
					</ButtonLabel>
					<HugeiconsIcon
						aria-hidden
						className="size-5 shrink-0"
						icon={ArrowDown01Icon}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-[320px] rounded-3xl border-border/80 bg-popover p-2 shadow-2xl"
					sideOffset={8}
				>
					<DropdownMenuLabel className="px-3 pt-2 pb-2 text-base text-muted-foreground">
						Commit to
					</DropdownMenuLabel>
					{loading ? (
						<div className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-sm">
							<HugeiconsIcon
								aria-hidden
								className="size-4 animate-spin"
								icon={Loading01Icon}
							/>
							Loading branches…
						</div>
					) : (
						branchOptions.map((candidate) => (
							<DropdownMenuItem
								className="min-h-11 gap-3 rounded-2xl px-3 text-base"
								disabled={disabled}
								key={candidate}
								onClick={() => onSelectBranch(candidate)}
							>
								<HugeiconsIcon
									aria-hidden
									className="size-5 shrink-0 text-muted-foreground"
									icon={GitBranchIcon}
								/>
								<span className="min-w-0 flex-1 truncate">{candidate}</span>
								{candidate === branch && (
									<HugeiconsIcon
										aria-hidden
										className="size-5 shrink-0"
										icon={Tick02Icon}
									/>
								)}
							</DropdownMenuItem>
						))
					)}
					<DropdownMenuSeparator className="my-2" />
					<DropdownMenuItem
						className="min-h-11 gap-3 rounded-2xl px-3 text-base"
						disabled={disabled || !onCreateBranch}
						onClick={() => setNewBranchOpen(true)}
					>
						<HugeiconsIcon
							aria-hidden
							className="size-5 shrink-0 text-muted-foreground"
							icon={Add01Icon}
						/>
						New branch
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog
				onOpenChange={(open) => {
					setNewBranchOpen(open);
					if (!open) {
						setNewBranchError(null);
					}
				}}
				open={newBranchOpen}
			>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>New branch</DialogTitle>
						<DialogDescription>
							Create a branch from the current commit and switch to it.
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label="New branch name"
						onChange={(event) => {
							setNewBranchName(event.target.value);
							setNewBranchError(null);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void handleCreateBranch();
							}
						}}
						placeholder="feature/my-branch"
						spellCheck={false}
						value={newBranchName}
					/>
					{newBranchError && (
						<p className="text-destructive text-xs">{newBranchError}</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => setNewBranchOpen(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={!newBranchName.trim()}
							onClick={() => void handleCreateBranch()}
							type="button"
						>
							Create branch
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

const COMMIT_ACTIONS: ReadonlyArray<{
	action: GitCommitAction;
	icon: typeof GitCommitIcon;
	label: string;
}> = [
	{ action: "commit", icon: GitCommitIcon, label: "Commit" },
	{ action: "commit-push", icon: CloudUploadIcon, label: "Commit and push" },
	{ action: "push", icon: CloudUploadIcon, label: "Push" },
];

export interface GitActionDialogProps {
	branch: string;
	branches: string[];
	branchesLoading: boolean;
	commitMessage: string;
	deletions: number;
	error?: string | null;
	includeUnstaged: boolean;
	insertions: number;
	onBranchMenuOpenChange: (open: boolean) => void;
	onCommitMessageChange: (message: string) => void;
	onCreateBranch?: (name: string) => Promise<string | null>;
	onIncludeUnstagedChange: (include: boolean) => void;
	onOpenChange: (open: boolean) => void;
	onSelectBranch: (branch: string) => void;
	onSubmit: (action: GitCommitAction) => void;
	open: boolean;
	progress?: GitProgressPhase;
}

export function GitActionDialog({
	branch,
	branches,
	branchesLoading,
	commitMessage,
	deletions,
	error,
	includeUnstaged,
	insertions,
	onBranchMenuOpenChange,
	onCommitMessageChange,
	onCreateBranch,
	onIncludeUnstagedChange,
	onOpenChange,
	onSelectBranch,
	onSubmit,
	open,
	progress,
}: GitActionDialogProps) {
	const busy = progress !== undefined;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="max-h-[calc(100vh-2rem)] gap-0 overflow-visible rounded-[28px] border-border/80 bg-background/95 p-3 shadow-2xl backdrop-blur-xl sm:max-w-[760px]"
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>Commit or push changes</DialogTitle>
					<DialogDescription>
						Choose a branch and an action for the current changes.
					</DialogDescription>
				</DialogHeader>
				<BranchTargetPicker
					branch={branch}
					branches={branches}
					disabled={busy}
					loading={branchesLoading}
					onBranchMenuOpenChange={onBranchMenuOpenChange}
					onCreateBranch={onCreateBranch}
					onSelectBranch={onSelectBranch}
				/>
				<textarea
					aria-label="Commit message"
					className="min-h-52 w-full resize-none border-0 bg-transparent px-4 py-5 text-2xl leading-tight outline-none placeholder:text-muted-foreground/80 focus:ring-0 sm:min-h-60 sm:text-3xl"
					disabled={busy}
					onChange={(event) => onCommitMessageChange(event.target.value)}
					placeholder="Commit message (leave blank to generate)…"
					value={commitMessage}
				/>
				<label className="flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3 text-lg">
					<Checkbox
						checked={includeUnstaged}
						className="size-5 rounded-lg"
						disabled={busy}
						onCheckedChange={(checked) =>
							onIncludeUnstagedChange(checked === true)
						}
					/>
					<span className="min-w-0 flex-1">Include unstaged changes</span>
					<DialogDiffStats deletions={deletions} insertions={insertions} />
				</label>
				{error && (
					<p className="mx-4 mb-3 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
						{error}
					</p>
				)}
				<div className="border-border/70 border-t pt-2">
					{COMMIT_ACTIONS.map((item, index) => (
						<button
							className={cn(
								"flex min-h-14 w-full items-center gap-4 rounded-3xl px-4 text-left text-xl transition-colors hover:bg-muted/80 focus-visible:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								index === 0 && "bg-muted/80",
								busy && "cursor-wait opacity-60"
							)}
							disabled={busy}
							key={item.action}
							onClick={() => onSubmit(item.action)}
							type="button"
						>
							<HugeiconsIcon
								aria-hidden
								className="size-6 shrink-0 text-muted-foreground"
								icon={item.icon}
							/>
							<span className="min-w-0 flex-1">{item.label}</span>
							{item.action === "commit" && (
								<kbd className="rounded-full bg-background/40 px-3 py-1 font-mono text-base text-muted-foreground">
									⌘↵
								</kbd>
							)}
						</button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

const PULL_REQUEST_ACTIONS: ReadonlyArray<{
	action: PullRequestAction;
	icon: typeof Share08Icon;
	label: string;
}> = [
	{ action: "draft", icon: Share08Icon, label: "Create draft PR" },
	{ action: "create", icon: Share08Icon, label: "Create PR" },
	{ action: "open", icon: ArrowUpRight01Icon, label: "Open PR in browser" },
];

export interface PullRequestDialogProps {
	baseBranch: string;
	branch: string;
	deletions: number;
	description: string;
	error?: string | null;
	includeUnstaged: boolean;
	insertions: number;
	onDescriptionChange: (description: string) => void;
	onIncludeUnstagedChange: (include: boolean) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: (action: PullRequestAction) => void;
	onTitleChange: (title: string) => void;
	open: boolean;
	progress?: GitProgressPhase;
	title: string;
}

export function PullRequestDialog({
	baseBranch,
	branch,
	deletions,
	description,
	error,
	includeUnstaged,
	insertions,
	onDescriptionChange,
	onIncludeUnstagedChange,
	onOpenChange,
	onSubmit,
	onTitleChange,
	open,
	progress,
	title,
}: PullRequestDialogProps) {
	const busy = progress !== undefined;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-[28px] border-border/80 bg-background/95 p-3 shadow-2xl backdrop-blur-xl sm:max-w-[760px]"
				showCloseButton={false}
			>
				<DialogHeader className="px-4 pt-3">
					<DialogTitle className="font-normal text-2xl text-muted-foreground sm:text-3xl">
						{branch} → {baseBranch}
					</DialogTitle>
					<DialogDescription className="sr-only">
						Create a pull request from this branch.
					</DialogDescription>
				</DialogHeader>
				<input
					aria-label="Pull request title"
					className="w-full border-0 bg-transparent px-4 pt-10 pb-3 font-medium text-2xl outline-none placeholder:text-muted-foreground/80 focus:ring-0 sm:text-3xl"
					disabled={busy}
					onChange={(event) => onTitleChange(event.target.value)}
					placeholder="Title"
					value={title}
				/>
				<textarea
					aria-label="Pull request description"
					className="min-h-52 w-full resize-none border-0 bg-transparent px-4 py-3 text-2xl leading-tight outline-none placeholder:text-muted-foreground/80 focus:ring-0 sm:min-h-60 sm:text-3xl"
					disabled={busy}
					onChange={(event) => onDescriptionChange(event.target.value)}
					placeholder="Description (leave empty to generate)"
					value={description}
				/>
				<label className="flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3 text-lg">
					<Checkbox
						checked={includeUnstaged}
						className="size-5 rounded-lg"
						disabled={busy}
						onCheckedChange={(checked) =>
							onIncludeUnstagedChange(checked === true)
						}
					/>
					<span className="min-w-0 flex-1">Commit and push local changes</span>
					<DialogDiffStats deletions={deletions} insertions={insertions} />
				</label>
				{error && (
					<p className="mx-4 mb-3 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
						{error}
					</p>
				)}
				<div className="border-border/70 border-t pt-2">
					{PULL_REQUEST_ACTIONS.map((item, index) => (
						<button
							className={cn(
								"flex min-h-14 w-full items-center gap-4 rounded-3xl px-4 text-left text-xl transition-colors hover:bg-muted/80 focus-visible:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								index === 1 && "bg-muted/80",
								busy && "cursor-wait opacity-60"
							)}
							disabled={busy}
							key={item.action}
							onClick={() => onSubmit(item.action)}
							type="button"
						>
							<HugeiconsIcon
								aria-hidden
								className="size-6 shrink-0 text-muted-foreground"
								icon={item.icon}
							/>
							<span className="min-w-0 flex-1">{item.label}</span>
							{item.action === "create" && (
								<kbd className="rounded-full bg-background/40 px-3 py-1 font-mono text-base text-muted-foreground">
									⌘↵
								</kbd>
							)}
						</button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
