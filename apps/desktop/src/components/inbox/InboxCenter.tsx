// apps/desktop/src/components/inbox/InboxCenter.tsx
//
// The Inbox tray — a preview of everything awaiting a decision (pending HITL
// approvals plus the quest engine's check-off suggestions) hung off the sidebar
// footer, with an "Open inbox" action that jumps to the full Inbox tab.
//
// Rows are actionable: approve/reject an approval, or accept/dismiss a task
// suggestion, without leaving the tray — the same mutations the full Inbox
// drives (useApprovals / useQuests), so the two surfaces never disagree. The
// affirmative action is a labelled pill, not a bare tick: this is the one
// surface in the app where mistaking "reject" for "approve" actually costs
// something. Clicking the row body opens the full Inbox; the popover is
// controlled so those clicks dismiss it.
//
// Chrome comes from TrayPopover (plain shadcn Popover + shared row/header
// primitives), matching the Downloads tray so both read as the same object.

import {
	Calendar04Icon,
	Cancel01Icon,
	CheckListIcon,
	InboxIcon,
	Pulse01Icon,
	SparklesIcon,
	WorkflowSquare01Icon,
	Wrench01Icon,
	ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Popover, PopoverTrigger } from "@ryu/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { useState } from "react";
import {
	TrayAction,
	TrayBadge,
	TrayEmpty,
	TrayFooter,
	TrayHeader,
	TrayIconAction,
	TrayPopoverContent,
	TrayRow,
	TrayScroll,
	TraySectionLabel,
	trayMeta,
	trayTriggerClass,
} from "@/src/components/shell/TrayPopover.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { useApprovals } from "@/src/hooks/useApprovals.ts";
import { useQuests } from "@/src/hooks/useQuests.ts";
import type { ApprovalKind, ApprovalRequest } from "@/src/lib/api/approvals.ts";
import type { Quest } from "@/src/lib/api/quests.ts";

/** How many of each group the tray previews before deferring to the full page. */
const PREVIEW_LIMIT = 6;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A glyph per approval kind so the list scans by shape, not just by text. */
const KIND_ICON: Record<ApprovalKind, IconSvgElement> = {
	tool_call: Wrench01Icon,
	workflow_gate: WorkflowSquare01Icon,
	scheduled_run: Calendar04Icon,
	trigger_run: ZapIcon,
	skill_synthesis: SparklesIcon,
	heal_fix: Pulse01Icon,
};

/** Short "2m"/"3h"/"5d" stamp — the tray has no room for a full timestamp. */
function shortAgo(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const at = new Date(value).getTime();
	if (Number.isNaN(at)) {
		return null;
	}
	const delta = Date.now() - at;
	if (delta < MINUTE_MS) {
		return "now";
	}
	if (delta < HOUR_MS) {
		return `${Math.floor(delta / MINUTE_MS)}m`;
	}
	if (delta < DAY_MS) {
		return `${Math.floor(delta / HOUR_MS)}h`;
	}
	return `${Math.floor(delta / DAY_MS)}d`;
}

/** Risk tags read as `network_access`; the meta line reads `network access`. */
function tagLabel(tag: string): string {
	return tag.replace(/[_-]+/g, " ");
}

function ApprovalRow({
	approval,
	busy,
	onApprove,
	onOpen,
	onReject,
}: {
	approval: ApprovalRequest;
	busy: boolean;
	onApprove: () => void;
	onOpen: () => void;
	onReject: () => void;
}) {
	const risky = approval.risk_tags.length > 0;
	return (
		<TrayRow
			actions={
				<>
					<TrayIconAction
						icon={Cancel01Icon}
						label="Reject"
						onClick={onReject}
						tone="danger"
					/>
					<TrayAction label="Approve" onClick={onApprove} tone="success" />
				</>
			}
			busy={busy}
			icon={KIND_ICON[approval.kind] ?? Wrench01Icon}
			// Risk is carried by the red glyph plus the leading meta segments; the
			// old red chips stacked a third line onto every risky row and turned the
			// list into a wall of pink.
			meta={trayMeta(
				...approval.risk_tags.slice(0, 2).map(tagLabel),
				approval.summary
			)}
			onOpen={onOpen}
			openLabel={`Open ${approval.title} in the inbox`}
			title={approval.title}
			tone={risky ? "danger" : "default"}
			trailing={shortAgo(approval.created_at)}
		/>
	);
}

function SuggestionRow({
	busy,
	onAccept,
	onDismiss,
	onOpen,
	quest,
}: {
	busy: boolean;
	onAccept: () => void;
	onDismiss: () => void;
	onOpen: () => void;
	quest: Quest;
}) {
	return (
		<TrayRow
			actions={
				<>
					<TrayIconAction
						icon={Cancel01Icon}
						label="Not yet"
						onClick={onDismiss}
					/>
					<TrayAction label="Done" onClick={onAccept} tone="success" />
				</>
			}
			busy={busy}
			icon={CheckListIcon}
			meta={quest.suggestion?.reason}
			onOpen={onOpen}
			openLabel={`Open ${quest.title} in the inbox`}
			title={`Finished “${quest.title}”?`}
		/>
	);
}

export function InboxCenter() {
	const { openTab } = useTabsContext();
	const approvals = useApprovals();
	const quests = useQuests();
	const [open, setOpen] = useState(false);
	// useQuests exposes no pending flag for accept/dismissSuggestion (only for
	// judge/delete), so the row's spinner state is tracked here.
	const [decidingQuest, setDecidingQuest] = useState<string | null>(null);

	const decideQuest = (id: string, run: (id: string) => Promise<unknown>) => {
		setDecidingQuest(id);
		run(id)
			.catch(() => undefined)
			.finally(() =>
				setDecidingQuest((current) => (current === id ? null : current))
			);
	};

	const pending = approvals.approvals.filter((a) => a.status === "pending");
	// Open quests carrying a pending check-off suggestion (mirrors InboxPage).
	const taskSuggestions = quests.quests.filter(
		(q) => q.status === "open" && q.suggestion
	);
	const pendingCount = pending.length + taskSuggestions.length;
	const riskyCount = pending.filter((a) => a.risk_tags.length > 0).length;
	const hiddenApprovals = Math.max(0, pending.length - PREVIEW_LIMIT);
	const hiddenTasks = Math.max(0, taskSuggestions.length - PREVIEW_LIMIT);
	const hidden = hiddenApprovals + hiddenTasks;

	const openInbox = () => {
		setOpen(false);
		openTab("/inbox");
	};

	let status: string | undefined;
	if (riskyCount > 0) {
		status = `${riskyCount} flagged risky`;
	} else if (pendingCount > 0) {
		status = "Waiting on you";
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger aria-label="Inbox" className={trayTriggerClass}>
							<HugeiconsIcon icon={InboxIcon} size={15} />
							<TrayBadge
								count={pendingCount}
								label="items awaiting a decision"
							/>
						</PopoverTrigger>
					}
				/>
				<TooltipContent>Inbox</TooltipContent>
			</Tooltip>
			<TrayPopoverContent>
				<TrayHeader count={pendingCount} status={status} title="Inbox" />
				{pendingCount > 0 ? (
					<TrayScroll>
						{pending.length > 0 && (
							<>
								<TraySectionLabel count={pending.length}>
									Approvals
								</TraySectionLabel>
								{pending.slice(0, PREVIEW_LIMIT).map((approval) => (
									<ApprovalRow
										approval={approval}
										busy={approvals.deciding === approval.id}
										key={approval.id}
										onApprove={() => {
											approvals.approve(approval.id).catch(() => undefined);
										}}
										onOpen={openInbox}
										onReject={() => {
											approvals.reject(approval.id).catch(() => undefined);
										}}
									/>
								))}
							</>
						)}
						{taskSuggestions.length > 0 && (
							<>
								<TraySectionLabel count={taskSuggestions.length}>
									Tasks
								</TraySectionLabel>
								{taskSuggestions.slice(0, PREVIEW_LIMIT).map((quest) => (
									<SuggestionRow
										busy={decidingQuest === quest.id}
										key={quest.id}
										onAccept={() =>
											decideQuest(quest.id, quests.acceptSuggestion)
										}
										onDismiss={() =>
											decideQuest(quest.id, quests.dismissSuggestion)
										}
										onOpen={openInbox}
										quest={quest}
									/>
								))}
							</>
						)}
						{hidden > 0 && (
							<button
								className="rounded-[18px] px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
								onClick={openInbox}
								type="button"
							>
								{hidden} more in the full inbox
							</button>
						)}
					</TrayScroll>
				) : (
					<TrayEmpty
						description="Approvals and task check-offs land here when Ryu needs a decision."
						icon={InboxIcon}
						title="You're all caught up"
					/>
				)}
				<TrayFooter label="Open inbox" onClick={openInbox} />
			</TrayPopoverContent>
		</Popover>
	);
}
