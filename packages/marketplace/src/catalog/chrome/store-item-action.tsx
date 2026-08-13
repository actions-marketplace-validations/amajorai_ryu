// packages/marketplace/src/catalog/chrome/store-item-action.tsx
//
// The one Store action control every catalog card + detail header uses, so the
// affordance is identical across Apps, Plugins, Models, Skills, MCP, and Agents.
// It is the generalization of the models page's morph button:
//
//   • not installed          → an "Add" button (with live download %), wrapped
//                              in a right-click ContextMenu.
//   • installed, no enable    → 3-dot menu with Remove (+ Report).
//   • installed + enabled     → 3-dot menu with Disable, Report, Remove.
//   • installed + disabled    → 3-dot menu with Enable, Report, Remove.
//
// The user-facing verb is Add / Adding… / Added / Remove. The PROPS keep the
// install vocabulary (`installed`, `onInstall`, `onUninstall`) deliberately:
// that is what the lifecycle is called everywhere from Core outwards, and
// renaming the wire to match the copy would make the two halves harder to trace,
// not easier.
//
// Sections without an enable/disable concept (Models per-file, Agents, MCP) pass
// `enabled={undefined}`; sections that have one (Apps, Skills) pass a boolean.
//
// The menu also carries **Settings** whenever the surface can resolve where the
// item is configured (`onOpenSettings`). That is the only route from a listing to
// its own credentials/config: a user looking for "where do I paste my Exa API
// key?" starts on the card they just installed, not in a settings dialog they
// have to guess the tab of. A surface with no settings destination (web, or an
// item that declares none) passes nothing and the row does not render.

import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	Delete01Icon,
	Download04Icon,
	MoreHorizontalIcon,
	PauseIcon,
	PlayIcon,
	Settings01Icon,
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
	/** Overrides the "Disable" menu label (e.g. Engines' "Stop"). */
	disableLabel?: string;
	/** `undefined` = the item has no enable/disable concept (install/uninstall only). */
	enabled?: boolean;
	/** Overrides the "Enable" menu label (e.g. Engines' "Set as active"). */
	enableLabel?: string;
	installed: boolean;
	/** Locked items (e.g. the flagship agent) can't be removed. */
	locked?: boolean;
	lockedLabel?: string;
	onDisable?: () => void;
	onEnable?: () => void;
	onInstall?: () => void;
	/** Reveal this item's own settings (host's settings dialog, at its tab).
	 *  Omitted when the surface has no settings destination for it. */
	onOpenSettings?: () => void;
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
	onOpenSettings,
	onReport,
	reportTarget,
	affordance,
	className,
	enableLabel = "Enable",
	disableLabel = "Disable",
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

	// Whether the trailing overflow menu has anything to hold at all. Both the
	// read-only-affordance and the locked paths render a static primary control, so
	// Settings/Report can only reach the user through that menu.
	const hasOverflow = canReport || Boolean(onOpenSettings);
	const overflow = (
		<StoreItemOverflowMenu
			className={className}
			onOpenSettings={onOpenSettings}
			onReport={canReport ? handleReport : undefined}
		/>
	);

	if (affordance) {
		if (!hasOverflow) {
			return <>{affordance}</>;
		}
		return (
			<div className="flex items-center gap-0.5">
				{affordance}
				{overflow}
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
						Add
					</InstallProgressButton>
				</ContextMenuTrigger>
				<ContextMenuContent align="end">
					<ContextMenuItem onClick={onInstall}>
						<HugeiconsIcon className="size-4" icon={Download04Icon} />
						Add
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
		// Locked = built-in / un-removable. It has no lifecycle verbs, but it is
		// exactly the kind of item that DOES have settings, so the overflow menu
		// still renders whenever there is something behind it.
		if (!hasOverflow) {
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
				{overflow}
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
					disableLabel={disableLabel}
					enableLabel={enableLabel}
					hasEnableConcept={hasEnableConcept}
					isEnabled={isEnabled}
					onDisable={onDisable}
					onEnable={onEnable}
					onOpenSettings={onOpenSettings}
					onReport={handleReport}
					onUninstall={onUninstall}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Shared menu items used by both the installed DropdownMenu and the
 * not-installed ContextMenu. Renders Settings, the Enable/Disable toggle,
 * Report, and Remove — each conditionally.
 */
function StoreItemMenuItems({
	hasEnableConcept,
	isEnabled,
	canReport,
	onEnable,
	onDisable,
	onOpenSettings,
	onReport,
	onUninstall,
	enableLabel = "Enable",
	disableLabel = "Disable",
}: {
	canReport: boolean;
	disableLabel?: string;
	enableLabel?: string;
	hasEnableConcept: boolean;
	isEnabled: boolean;
	onDisable?: () => void;
	onEnable?: () => void;
	onOpenSettings?: () => void;
	onReport: () => void;
	onUninstall?: () => void;
}) {
	// Whether a toggle row actually renders — an enable concept with no handler for
	// the CURRENT direction renders nothing, so the separator must not assume one.
	const hasToggleItem =
		hasEnableConcept && Boolean(isEnabled ? onDisable : onEnable);
	return (
		<>
			{/* Settings leads the menu: it is the reason a user opens it on an item
			    that is already installed and working. */}
			{onOpenSettings ? (
				<DropdownMenuItem onClick={onOpenSettings}>
					<HugeiconsIcon className="size-4" icon={Settings01Icon} />
					Settings
				</DropdownMenuItem>
			) : null}
			{hasEnableConcept &&
				(isEnabled ? (
					// A one-way toggle (an Engines "Text" row can be SWAPPED to, never
					// switched off) passes no `onDisable` — render nothing rather than a
					// menu entry that does nothing when clicked.
					onDisable ? (
						<DropdownMenuItem onClick={onDisable}>
							<HugeiconsIcon className="size-4" icon={PauseIcon} />
							{disableLabel}
						</DropdownMenuItem>
					) : null
				) : onEnable ? (
					<DropdownMenuItem onClick={onEnable}>
						<HugeiconsIcon className="size-4" icon={PlayIcon} />
						{enableLabel}
					</DropdownMenuItem>
				) : null)}
			{canReport ? (
				<DropdownMenuItem onClick={onReport}>
					<HugeiconsIcon className="size-4" icon={Alert02Icon} />
					Report
				</DropdownMenuItem>
			) : null}
			{onUninstall ? (
				<>
					{hasToggleItem || canReport ? <DropdownMenuSeparator /> : null}
					<DropdownMenuItem onClick={onUninstall} variant="destructive">
						<HugeiconsIcon className="size-4" icon={Delete01Icon} />
						Remove
					</DropdownMenuItem>
				</>
			) : null}
		</>
	);
}

/**
 * Reusable context menu content for not-installed store items.
 * Catalog sections use this as the `contextMenu` prop on StoreCatalogCard
 * so right-clicking the card shows Add + Report (when available).
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
					Add
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

/**
 * Standalone 3-dot overflow for items whose primary control is static — the
 * locked ("Built in") pill, the read-only web affordance, and the "Required"
 * badge a mandatory listing renders instead of lifecycle buttons. Holds Settings
 * and/or Report; renders nothing when it would be empty, so a caller can mount it
 * unconditionally.
 *
 * Exported because the mandatory-listing branch has no StoreItemAction to hang
 * these off: it deliberately renders no lifecycle control, but a required app is
 * still configurable and its settings must stay reachable from the card.
 */
export function StoreItemOverflowMenu({
	onOpenSettings,
	onReport,
	className,
}: {
	className?: string;
	onOpenSettings?: () => void;
	onReport?: () => void;
}) {
	if (!(onOpenSettings || onReport)) {
		return null;
	}
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
				{onOpenSettings ? (
					<DropdownMenuItem onClick={onOpenSettings}>
						<HugeiconsIcon className="size-4" icon={Settings01Icon} />
						Settings
					</DropdownMenuItem>
				) : null}
				{onReport ? (
					<DropdownMenuItem onClick={onReport}>
						<HugeiconsIcon className="size-4" icon={Alert02Icon} />
						Report
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
