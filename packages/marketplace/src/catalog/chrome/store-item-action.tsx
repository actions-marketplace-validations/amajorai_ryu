// packages/marketplace/src/catalog/chrome/store-item-action.tsx
//
// The one Store action control every catalog card + detail header uses, so the
// affordance is identical across Apps, Plugins, Models, Skills, MCP, and Agents.
// It is the generalization of the models page's morph button:
//
//   • not installed          → an Install button (with live download %), wrapped
//                              in a right-click ContextMenu.
//   • installed, no enable    → 3-dot menu with Uninstall (+ Report).
//   • installed + enabled     → 3-dot menu with Disable, Report, Uninstall.
//   • installed + disabled    → 3-dot menu with Enable, Report, Uninstall.
//
// Sections without an enable/disable concept (Models per-file, Agents, MCP) pass
// `enabled={undefined}`; sections that have one (Apps, Skills) pass a boolean.

import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	Delete01Icon,
	Download04Icon,
	MoreHorizontalIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { InstallProgressButton } from "@ryu/blocks/desktop/install-button.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useOptionalReport } from "../../report/report-provider.tsx";
import type { ReportTarget } from "../../report/types.ts";

export interface StoreItemActionProps {
	/** Rendered instead of the lifecycle buttons on a read-only surface (web). */
	affordance?: React.ReactNode;
	/** A lifecycle call is in flight — the control shows a spinner and disables. */
	busy?: boolean;
	className?: string;
	/** `undefined` = the item has no enable/disable concept (install/uninstall only). */
	enabled?: boolean;
	installed: boolean;
	/** Locked items (e.g. the flagship agent) can't be removed. */
	locked?: boolean;
	lockedLabel?: string;
	onDisable?: () => void;
	onEnable?: () => void;
	onInstall?: () => void;
	/** Explicit report handler; falls back to ReportProvider + reportTarget. */
	onReport?: () => void;
	onUninstall?: () => void;
	/** Live install completion 0–100 (or null when the size is unknown). */
	percent?: number | null;
	/** Identity passed to the shared ReportProvider when onReport is omitted. */
	reportTarget?: ReportTarget;
}

export default function StoreItemAction({
	installed,
	enabled,
	busy = false,
	percent = null,
	locked = false,
	lockedLabel = "Built in",
	onInstall,
	onUninstall,
	onEnable,
	onDisable,
	onReport,
	reportTarget,
	affordance,
	className,
}: StoreItemActionProps) {
	const reportCtx = useOptionalReport();
	const canReport = Boolean(onReport || (reportCtx && reportTarget));
	const handleReport = () => {
		if (onReport) {
			onReport();
			return;
		}
		if (reportCtx && reportTarget) {
			reportCtx.open(reportTarget);
		}
	};

	if (affordance) {
		if (!canReport) {
			return <>{affordance}</>;
		}
		return (
			<div className="flex items-center gap-0.5">
				{affordance}
				<ReportButton className={className} onReport={handleReport} />
			</div>
		);
	}

	if (!installed) {
		return (
			<ContextMenu>
				<ContextMenuTrigger
					className={className}
					render={<div className="flex items-center" />}
				>
					<InstallProgressButton
						idleVariant="default"
						installing={busy}
						onClick={onInstall}
						percent={percent}
					>
						Install
					</InstallProgressButton>
				</ContextMenuTrigger>
				<ContextMenuContent align="end">
					<ContextMenuItem onClick={onInstall}>
						<HugeiconsIcon className="size-4" icon={Download04Icon} />
						Install
					</ContextMenuItem>
					{canReport ? (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem onClick={handleReport}>
								<HugeiconsIcon className="size-4" icon={Alert02Icon} />
								Report
							</ContextMenuItem>
						</>
					) : null}
				</ContextMenuContent>
			</ContextMenu>
		);
	}

	if (locked) {
		if (!canReport) {
			return (
				<Button className={className} disabled size="sm" variant="secondary">
					<HugeiconsIcon
						className="size-3.5 text-success"
						icon={CheckmarkCircle02Icon}
					/>
					{lockedLabel}
				</Button>
			);
		}
		return (
			<div className="flex items-center gap-0.5">
				<Button disabled size="sm" variant="secondary">
					<HugeiconsIcon
						className="size-3.5 text-success"
						icon={CheckmarkCircle02Icon}
					/>
					{lockedLabel}
				</Button>
				<ReportButton className={className} onReport={handleReport} />
			</div>
		);
	}

	// Installed items collapse to a single 3-dot menu instead of a morphing pill,
	// so the row stays quiet at rest and the lifecycle actions (enable/disable +
	// uninstall) live behind one deliberate click. `enabled === undefined` means
	// the item has no enable/disable concept (Models per-file, Agents, MCP, and
	// Skills whose CLI can't toggle) — the menu then holds only Uninstall (+ Report).
	const hasEnableConcept = enabled !== undefined;
	const isEnabled = enabled === true;

	// While a lifecycle call is in flight the trigger shows a spinner and locks,
	// so a second click can't race the first.
	if (busy) {
		return (
			<Button
				aria-label="Working…"
				className={className}
				disabled
				size="icon-sm"
				variant="ghost"
			>
				<Spinner className="size-4" />
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="Manage"
						className={className}
						size="icon-sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-4" icon={MoreHorizontalIcon} />
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				<StoreItemMenuItems
					canReport={canReport}
					hasEnableConcept={hasEnableConcept}
					isEnabled={isEnabled}
					onDisable={onDisable}
					onEnable={onEnable}
					onReport={handleReport}
					onUninstall={onUninstall}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Shared menu items used by both the installed DropdownMenu and the
 * not-installed ContextMenu. Renders Enable/Disable toggle, Report,
 * and Uninstall — each conditionally.
 */
function StoreItemMenuItems({
	hasEnableConcept,
	isEnabled,
	canReport,
	onEnable,
	onDisable,
	onReport,
	onUninstall,
}: {
	canReport: boolean;
	hasEnableConcept: boolean;
	isEnabled: boolean;
	onDisable?: () => void;
	onEnable?: () => void;
	onReport: () => void;
	onUninstall?: () => void;
}) {
	return (
		<>
			{hasEnableConcept &&
				(isEnabled ? (
					<DropdownMenuItem onClick={onDisable}>
						<HugeiconsIcon className="size-4" icon={PauseIcon} />
						Disable
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onClick={onEnable}>
						<HugeiconsIcon className="size-4" icon={PlayIcon} />
						Enable
					</DropdownMenuItem>
				))}
			{canReport ? (
				<DropdownMenuItem onClick={onReport}>
					<HugeiconsIcon className="size-4" icon={Alert02Icon} />
					Report
				</DropdownMenuItem>
			) : null}
			{onUninstall ? (
				<>
					{hasEnableConcept || canReport ? <DropdownMenuSeparator /> : null}
					<DropdownMenuItem onClick={onUninstall} variant="destructive">
						<HugeiconsIcon className="size-4" icon={Delete01Icon} />
						Uninstall
					</DropdownMenuItem>
				</>
			) : null}
		</>
	);
}

/**
 * Reusable context menu content for not-installed store items.
 * Catalog sections use this as the `contextMenu` prop on StoreCatalogCard
 * so right-clicking the card shows Install + Report (when available).
 */
export function StoreItemContextMenuContent({
	onInstall,
	onReport,
	canReport,
}: {
	canReport: boolean;
	onInstall?: () => void;
	onReport: () => void;
}) {
	return (
		<>
			{onInstall ? (
				<ContextMenuItem onClick={onInstall}>
					<HugeiconsIcon className="size-4" icon={Download04Icon} />
					Install
				</ContextMenuItem>
			) : null}
			{canReport ? (
				<>
					{onInstall ? <ContextMenuSeparator /> : null}
					<ContextMenuItem onClick={onReport}>
						<HugeiconsIcon className="size-4" icon={Alert02Icon} />
						Report
					</ContextMenuItem>
				</>
			) : null}
		</>
	);
}

/** Standalone 3-dot report overflow used next to locked / web affordance. */
function ReportButton({
	onReport,
	className,
}: {
	className?: string;
	onReport: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="More actions"
						className={className}
						size="icon-sm"
						variant="ghost"
					>
						<HugeiconsIcon className="size-4" icon={MoreHorizontalIcon} />
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onReport}>
					<HugeiconsIcon className="size-4" icon={Alert02Icon} />
					Report
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
