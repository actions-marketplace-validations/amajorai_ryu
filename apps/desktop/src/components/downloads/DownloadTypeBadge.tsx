// apps/desktop/src/components/downloads/DownloadTypeBadge.tsx
//
// The small type pill on a download row ("Chat model", "Engine", "Unpacking").
// Sits in TrayRow's `trailing` slot, which is the right-aligned stamp on the
// title line — so the type is always in the same place on every row instead of
// being smuggled into the name as a parenthetical on the rows that happened to
// have one.
//
// The explanation is a native `title` rather than a Tooltip: DownloadRow already
// decided against tooltips inside the row (nesting another trigger made the whole
// row a tooltip target), and the badge is a passive stamp, not a control.

import { Badge } from "@ryu/ui/components/badge";
import { cn } from "@ryu/ui/lib/utils";
import type {
	BadgeTone,
	DownloadBadge,
} from "@/src/lib/catalog/downloadBadge.ts";

// Muted fills rather than solid ones: the row's own title, progress bar and
// controls are the things to read first — the type is orienting, not shouting.
const TONE_CLASS: Record<BadgeTone, string> = {
	amber: "bg-warning/10 text-warning",
	blue: "bg-primary/10 text-primary",
	emerald: "bg-success/10 text-success",
	neutral: "bg-muted text-muted-foreground",
	rose: "bg-destructive/10 text-destructive",
	violet: "bg-accent text-accent-foreground",
};

export function DownloadTypeBadge({ badge }: { badge: DownloadBadge }) {
	return (
		<Badge
			className={cn(
				"h-4 px-1.5 font-medium text-[10px] leading-none",
				TONE_CLASS[badge.tone]
			)}
			title={badge.tooltip}
			variant="secondary"
		>
			{badge.label}
		</Badge>
	);
}
