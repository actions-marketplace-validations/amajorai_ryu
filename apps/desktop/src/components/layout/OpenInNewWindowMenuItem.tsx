import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ContextMenuItem } from "@ryu/ui/components/context-menu.tsx";
import { DropdownMenuItem } from "@ryu/ui/components/dropdown-menu.tsx";
import { useAppSurface } from "@/src/contexts/app-surface-context.tsx";

interface OpenInNewWindowMenuItemProps {
	iconClassName?: string;
	onClick: () => void;
}

export function OpenInNewWindowContextMenuItem({
	iconClassName = "mr-2 size-4",
	onClick,
}: OpenInNewWindowMenuItemProps) {
	if (!useAppSurface().canOpenNativeWindows) {
		return null;
	}

	return (
		<ContextMenuItem onClick={onClick}>
			<HugeiconsIcon className={iconClassName} icon={LinkSquare02Icon} />
			Open in new window
		</ContextMenuItem>
	);
}

export function OpenInNewWindowDropdownMenuItem({
	iconClassName = "mr-2 size-4",
	onClick,
}: OpenInNewWindowMenuItemProps) {
	if (!useAppSurface().canOpenNativeWindows) {
		return null;
	}

	return (
		<DropdownMenuItem onClick={onClick}>
			<HugeiconsIcon className={iconClassName} icon={LinkSquare02Icon} />
			Open in new window
		</DropdownMenuItem>
	);
}
