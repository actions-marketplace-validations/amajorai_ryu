import {
	ArrowUpRight01Icon,
	Delete01Icon,
	Download04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ContextMenuItem } from "@ryu/ui/components/context-menu.tsx";
import { DropdownMenuItem } from "@ryu/ui/components/dropdown-menu.tsx";

export interface StandaloneAppMenuProps {
	enabled: boolean;
	/** The manifest exposes an enabled Companion surface. */
	hasCompanion: boolean;
	installed: boolean;
	onInstall?: () => void;
	onOpen?: () => void;
	onRemove?: () => void;
}

/** Right-click rows shared by sidebar, Launchpad, and Store app cards. */
export function StandaloneAppContextMenuItems({
	hasCompanion,
	enabled,
	installed,
	onInstall,
	onOpen,
	onRemove,
}: StandaloneAppMenuProps) {
	if (!hasCompanion) {
		return null;
	}
	if (!enabled) {
		return (
			<ContextMenuItem disabled>
				Enable the app to use standalone
			</ContextMenuItem>
		);
	}
	if (installed) {
		return (
			<>
				<ContextMenuItem onClick={onOpen}>
					<HugeiconsIcon className="size-4" icon={ArrowUpRight01Icon} />
					Open standalone app
				</ContextMenuItem>
				<ContextMenuItem onClick={onRemove} variant="destructive">
					<HugeiconsIcon className="size-4" icon={Delete01Icon} />
					Remove standalone app
				</ContextMenuItem>
			</>
		);
	}
	return (
		<ContextMenuItem onClick={onInstall}>
			<HugeiconsIcon className="size-4" icon={Download04Icon} />
			Install as standalone app
		</ContextMenuItem>
	);
}

/** Dropdown rows for the Store's shared overflow action. */
export function StandaloneAppDropdownMenuItems({
	hasCompanion,
	enabled,
	installed,
	onInstall,
	onOpen,
	onRemove,
}: StandaloneAppMenuProps) {
	if (!hasCompanion) {
		return null;
	}
	if (!enabled) {
		return (
			<DropdownMenuItem disabled>
				Enable the app to use standalone
			</DropdownMenuItem>
		);
	}
	if (installed) {
		return (
			<>
				<DropdownMenuItem onClick={onOpen}>
					<HugeiconsIcon className="size-4" icon={ArrowUpRight01Icon} />
					Open standalone app
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onRemove}>
					<HugeiconsIcon className="size-4" icon={Delete01Icon} />
					Remove standalone app
				</DropdownMenuItem>
			</>
		);
	}
	return (
		<DropdownMenuItem onClick={onInstall}>
			<HugeiconsIcon className="size-4" icon={Download04Icon} />
			Install as standalone app
		</DropdownMenuItem>
	);
}
