import { AlertCircleIcon, FolderTreeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { useEffect, useId, useState } from "react";

export interface WorktreeHandoffControlProps {
	/** The suggested branch name shown whenever the dialog opens. */
	branchName: string;
	/** True when the current chat has an in-flight response to interrupt. */
	chatRunning: boolean;
	/** Persist the selected branch and arm the current chat for a worktree. */
	onHandOff: (branchName: string) => void;
	/** Stop the active response before the handoff is armed. */
	onInterrupt?: () => void;
}

/**
 * The pinned-summary Environment action for moving the current chat onto a
 * persistent worktree. Core still owns worktree creation; this control updates
 * the current chat's run mode so the next turn is created in the selected
 * worktree.
 */
export function WorktreeHandoffControl({
	branchName,
	chatRunning,
	onHandOff,
	onInterrupt,
}: WorktreeHandoffControlProps) {
	const [open, setOpen] = useState(false);
	const [draftBranchName, setDraftBranchName] = useState(branchName);
	const inputId = useId();

	useEffect(() => {
		if (open) {
			setDraftBranchName(branchName);
		}
	}, [branchName, open]);

	const trimmedBranchName = draftBranchName.trim();

	const handleHandOff = () => {
		if (!trimmedBranchName) {
			return;
		}
		if (chatRunning) {
			onInterrupt?.();
		}
		onHandOff(trimmedBranchName);
		setOpen(false);
	};

	return (
		<>
			<Button
				className="flex w-full items-center justify-center gap-1.5 border-border/70 text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground"
				data-testid="open-worktree-handoff"
				onClick={() => setOpen(true)}
				type="button"
				variant="outline"
			>
				<HugeiconsIcon aria-hidden className="size-3.5" icon={FolderTreeIcon} />
				Hand off to worktree
			</Button>

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent
					className="gap-5 px-6 py-7 sm:max-w-[31.5rem]"
					data-testid="worktree-handoff-dialog"
				>
					<DialogHeader className="gap-2 pr-8">
						<div className="flex items-center gap-3">
							<HugeiconsIcon
								aria-hidden
								className="size-5 shrink-0 text-muted-foreground"
								icon={FolderTreeIcon}
								strokeWidth={1.7}
							/>
							<DialogTitle className="text-xl leading-7">
								Hand off chat to worktree
							</DialogTitle>
						</div>
						<DialogDescription className="leading-6">
							Create and check out a branch in a new worktree to continue
							working in parallel.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<label className="font-medium text-sm" htmlFor={inputId}>
							Branch name
						</label>
						<Input
							autoFocus
							className="h-11 text-sm"
							id={inputId}
							onChange={(event) => setDraftBranchName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									handleHandOff();
								}
							}}
							placeholder="codex/my-feature"
							spellCheck={false}
							value={draftBranchName}
						/>
					</div>

					{chatRunning && (
						<div
							className="flex items-start gap-3 text-sm leading-6"
							role="alert"
						>
							<HugeiconsIcon
								aria-hidden
								className="mt-1 size-4 shrink-0 text-orange-500"
								icon={AlertCircleIcon}
								strokeWidth={1.8}
							/>
							<span>
								This chat is running, so handing it off will interrupt the
								current response
							</span>
						</div>
					)}

					<Button
						className="h-13 w-full text-base"
						disabled={!trimmedBranchName}
						onClick={handleHandOff}
						type="button"
					>
						Hand off
					</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
