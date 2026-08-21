import {
	UserMultiple02Icon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	type ResourceVisibility,
	resourceVisibilityGroup,
	resourceVisibilityLabel,
} from "@/src/lib/resource-visibility.ts";

export function ResourceVisibilityIndicator({
	className,
	system,
	visibility,
}: {
	className?: string;
	system?: boolean;
	visibility?: ResourceVisibility;
}) {
	const group = resourceVisibilityGroup(visibility ?? "private", system);
	const label = resourceVisibilityLabel(visibility ?? "private", system);
	return (
		<span
			aria-label={label}
			className={`inline-flex shrink-0 items-center justify-center text-muted-foreground/65 ${className ?? ""}`}
			title={label}
		>
			<HugeiconsIcon
				aria-hidden="true"
				icon={group === "private" ? ViewOffSlashIcon : UserMultiple02Icon}
				size={12}
			/>
		</span>
	);
}
